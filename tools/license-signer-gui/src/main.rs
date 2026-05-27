// Storyboard Copilot 授权签发图形工具
// 仅供发布者使用：负责加载本机私钥、对客户提供的机器码进行 Ed25519 签名

#![cfg_attr(all(target_os = "windows", not(debug_assertions)), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, bail, Context, Result};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use ed25519_dalek::{Signer, SigningKey, VerifyingKey, SECRET_KEY_LENGTH};
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};

const LICENSE_PREFIX: &str = "SBLIC1-";
const APP_TITLE: &str = "Storyboard Copilot 授权签发";
const HISTORY_FILE_NAME: &str = "license_history.json";

#[derive(Debug, Serialize)]
struct LicensePayload {
    #[serde(rename = "m")]
    machine: String,
    #[serde(rename = "e", skip_serializing_if = "Option::is_none")]
    expires: Option<String>,
    #[serde(rename = "n", skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LicenseRecord {
    machine: String,
    name: String,
    expires: String,
    token: String,
    issued_at: String,
}

struct App {
    private_key_path: PathBuf,
    private_key_status: String,
    signing_key: Option<Arc<SigningKey>>,
    public_key_hex: Option<String>,

    machine_input: String,
    name_input: String,
    expires_input: String,

    last_token: String,
    last_message: String,
    is_error: bool,

    history: Vec<LicenseRecord>,
    show_history: bool,
}

impl App {
    fn new(cc: &eframe::CreationContext<'_>) -> Self {
        configure_fonts(&cc.egui_ctx);

        let default_key_path = locate_default_private_key();
        let history = load_history(&default_key_path);
        let mut app = Self {
            private_key_path: default_key_path,
            private_key_status: String::new(),
            signing_key: None,
            public_key_hex: None,
            machine_input: String::new(),
            name_input: String::new(),
            expires_input: String::new(),
            last_token: String::new(),
            last_message: String::new(),
            is_error: false,
            history,
            show_history: false,
        };
        app.try_load_private_key();
        app
    }

    fn try_load_private_key(&mut self) {
        match load_signing_key(&self.private_key_path) {
            Ok(key) => {
                let public_hex = hex::encode(key.verifying_key().to_bytes());
                self.public_key_hex = Some(public_hex);
                self.signing_key = Some(Arc::new(key));
                self.private_key_status = format!("已加载: {}", self.private_key_path.display());
            }
            Err(err) => {
                self.signing_key = None;
                self.public_key_hex = None;
                self.private_key_status = format!("未加载（{err}）");
            }
        }
    }

    fn pick_private_key(&mut self) {
        if let Some(path) = rfd::FileDialog::new()
            .add_filter("私钥（hex）", &["hex", "txt"])
            .set_title("选择 license_private_key.hex")
            .pick_file()
        {
            self.private_key_path = path;
            self.try_load_private_key();
        }
    }

    fn handle_keygen(&mut self) {
        let target = self.private_key_path.clone();
        let dir = target.parent().map(PathBuf::from).unwrap_or_default();
        if !dir.as_os_str().is_empty() {
            if let Err(err) = std::fs::create_dir_all(&dir) {
                self.set_error(format!("创建目录失败: {err}"));
                return;
            }
        }

        if target.exists() {
            let confirm = rfd::MessageDialog::new()
                .set_title("覆盖密钥")
                .set_description(format!(
                    "{} 已存在，覆盖将作废所有已发出的授权码。\n确定要覆盖吗？",
                    target.display()
                ))
                .set_buttons(rfd::MessageButtons::YesNo)
                .show();
            if confirm != rfd::MessageDialogResult::Yes {
                return;
            }
        }

        let mut secret = [0u8; SECRET_KEY_LENGTH];
        OsRng.fill_bytes(&mut secret);
        let signing = SigningKey::from_bytes(&secret);
        let verifying = signing.verifying_key();

        if let Err(err) = std::fs::write(&target, hex::encode(secret)) {
            self.set_error(format!("写入私钥失败: {err}"));
            return;
        }
        let pub_path = dir.join("license_public_key.hex");
        if let Err(err) = std::fs::write(&pub_path, hex::encode(verifying.to_bytes())) {
            self.set_error(format!("写入公钥失败: {err}"));
            return;
        }

        self.try_load_private_key();
        self.set_success(format!(
            "已生成新密钥对：\n  私钥: {}\n  公钥: {}\n请把公钥复制到 src-tauri/keys/license_public_key.hex 后重新打包应用。",
            target.display(),
            pub_path.display()
        ));
    }

    fn handle_sign(&mut self) {
        let Some(signing) = self.signing_key.clone() else {
            self.set_error("请先加载或生成私钥".into());
            return;
        };

        let machine = self.machine_input.trim().to_string();
        if machine.is_empty() {
            self.set_error("请填写机器码".into());
            return;
        }

        let name = optional_string(&self.name_input);
        let expires = match optional_string(&self.expires_input) {
            Some(date) => match validate_date(&date) {
                Ok(()) => Some(date),
                Err(err) => {
                    self.set_error(err.to_string());
                    return;
                }
            },
            None => None,
        };

        let payload = LicensePayload {
            machine: machine.clone(),
            expires,
            name,
        };

        let payload_bytes = match serde_json::to_vec(&payload) {
            Ok(bytes) => bytes,
            Err(err) => {
                self.set_error(format!("序列化授权载荷失败: {err}"));
                return;
            }
        };
        let signature = signing.sign(&payload_bytes);
        let token = format!(
            "{}{}.{}",
            LICENSE_PREFIX,
            URL_SAFE_NO_PAD.encode(&payload_bytes),
            URL_SAFE_NO_PAD.encode(signature.to_bytes()),
        );

        self.last_token = token.clone();

        // 保存签发记录
        let record = LicenseRecord {
            machine: machine.clone(),
            name: self.name_input.trim().to_string(),
            expires: self.expires_input.trim().to_string(),
            token: token.clone(),
            issued_at: chrono_now(),
        };
        self.history.insert(0, record);
        save_history(&self.private_key_path, &self.history);

        let copy_state = match arboard::Clipboard::new() {
            Ok(mut clip) => clip.set_text(token).map(|_| true).unwrap_or(false),
            Err(_) => false,
        };
        if copy_state {
            self.set_success(format!("已为机器码 {machine} 生成授权码并复制到剪贴板"));
        } else {
            self.set_success(format!(
                "已为机器码 {machine} 生成授权码（剪贴板复制失败，请手动复制下方文本）"
            ));
        }
    }

    fn handle_save_token(&mut self) {
        if self.last_token.is_empty() {
            return;
        }
        let default_name = sanitize_filename(if self.name_input.trim().is_empty() {
            self.machine_input.trim()
        } else {
            self.name_input.trim()
        });
        if let Some(path) = rfd::FileDialog::new()
            .set_title("保存授权码")
            .set_file_name(format!("{default_name}.lic"))
            .add_filter("授权文件", &["lic", "txt"])
            .save_file()
        {
            if let Err(err) = std::fs::write(&path, &self.last_token) {
                self.set_error(format!("写入失败: {err}"));
            } else {
                self.set_success(format!("已保存到 {}", path.display()));
            }
        }
    }

    fn copy_token(&mut self) {
        if self.last_token.is_empty() {
            return;
        }
        match arboard::Clipboard::new()
            .and_then(|mut clip| clip.set_text(self.last_token.clone()))
        {
            Ok(_) => self.set_success("已复制授权码到剪贴板".into()),
            Err(err) => self.set_error(format!("复制失败: {err}")),
        }
    }

    fn copy_public_key(&mut self) {
        let Some(pub_hex) = self.public_key_hex.clone() else {
            return;
        };
        match arboard::Clipboard::new().and_then(|mut clip| clip.set_text(pub_hex)) {
            Ok(_) => self.set_success("已复制公钥到剪贴板".into()),
            Err(err) => self.set_error(format!("复制失败: {err}")),
        }
    }

    fn set_success(&mut self, msg: String) {
        self.last_message = msg;
        self.is_error = false;
    }

    fn set_error(&mut self, msg: String) {
        self.last_message = msg;
        self.is_error = true;
    }
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        egui::CentralPanel::default().show(ctx, |ui| {
            ui.heading("Storyboard Copilot 授权签发");
            ui.add_space(4.0);
            ui.label("用本机私钥为客户的机器码签发授权码。私钥永远不应离开本机。");
            ui.separator();

            // ---------- 私钥区 ----------
            ui.label(egui::RichText::new("私钥").strong());
            ui.horizontal(|ui| {
                ui.label("路径:");
                let path_text = self.private_key_path.display().to_string();
                ui.add(
                    egui::TextEdit::singleline(&mut path_text.clone())
                        .desired_width(420.0)
                        .interactive(false),
                );
                if ui.button("选择…").clicked() {
                    self.pick_private_key();
                }
                if ui.button("重新加载").clicked() {
                    self.try_load_private_key();
                }
            });
            ui.horizontal(|ui| {
                if ui.button("生成新密钥对").on_hover_text("覆盖会作废所有已发出的授权码").clicked() {
                    self.handle_keygen();
                }
                if let Some(pub_hex) = &self.public_key_hex {
                    ui.label(format!("公钥: {}…{}", &pub_hex[..8], &pub_hex[pub_hex.len() - 6..]));
                    if ui.button("复制公钥").clicked() {
                        self.copy_public_key();
                    }
                }
            });
            ui.label(
                egui::RichText::new(&self.private_key_status)
                    .small()
                    .color(if self.signing_key.is_some() {
                        egui::Color32::from_rgb(85, 170, 95)
                    } else {
                        egui::Color32::from_rgb(220, 130, 60)
                    }),
            );
            ui.separator();

            // ---------- 签发区 ----------
            ui.label(egui::RichText::new("签发授权").strong());
            egui::Grid::new("issue-grid")
                .num_columns(2)
                .spacing([12.0, 8.0])
                .show(ui, |ui| {
                    ui.label("机器码 *");
                    ui.add(
                        egui::TextEdit::singleline(&mut self.machine_input)
                            .hint_text("XXXX-XXXX-XXXX-XXXX")
                            .desired_width(360.0),
                    );
                    ui.end_row();

                    ui.label("客户名");
                    ui.add(
                        egui::TextEdit::singleline(&mut self.name_input)
                            .hint_text("可选，仅作展示与文件名")
                            .desired_width(360.0),
                    );
                    ui.end_row();

                    ui.label("过期日期");
                    ui.add(
                        egui::TextEdit::singleline(&mut self.expires_input)
                            .hint_text("可选，YYYY-MM-DD；留空表示永久")
                            .desired_width(360.0),
                    );
                    ui.end_row();
                });

            ui.add_space(8.0);
            ui.horizontal(|ui| {
                let enabled = self.signing_key.is_some();
                if ui
                    .add_enabled(enabled, egui::Button::new(egui::RichText::new("生成授权码").strong()))
                    .clicked()
                {
                    self.handle_sign();
                }
                if !enabled {
                    ui.label(
                        egui::RichText::new("请先加载或生成私钥")
                            .color(egui::Color32::from_rgb(220, 130, 60))
                            .small(),
                    );
                }
            });

            if !self.last_token.is_empty() {
                ui.add_space(6.0);
                ui.label(egui::RichText::new("授权码（已自动复制）").small());
                ui.add(
                    egui::TextEdit::multiline(&mut self.last_token.clone())
                        .desired_rows(5)
                        .desired_width(f32::INFINITY)
                        .interactive(false)
                        .font(egui::TextStyle::Monospace),
                );
                ui.horizontal(|ui| {
                    if ui.button("再次复制").clicked() {
                        self.copy_token();
                    }
                    if ui.button("保存为 .lic 文件…").clicked() {
                        self.handle_save_token();
                    }
                });
            }

            ui.separator();
            if !self.last_message.is_empty() {
                let color = if self.is_error {
                    egui::Color32::from_rgb(220, 80, 80)
                } else {
                    egui::Color32::from_rgb(85, 170, 95)
                };
                ui.label(egui::RichText::new(&self.last_message).color(color));
            }

            // ---------- 签发记录 ----------
            ui.separator();
            ui.horizontal(|ui| {
                ui.label(egui::RichText::new("签发记录").strong());
                ui.label(egui::RichText::new(format!("（共 {} 条）", self.history.len())).small().color(egui::Color32::from_rgb(150, 150, 150)));
                if ui.button(if self.show_history { "收起" } else { "展开" }).clicked() {
                    self.show_history = !self.show_history;
                }
            });

            if self.show_history && !self.history.is_empty() {
                egui::ScrollArea::vertical().max_height(200.0).show(ui, |ui| {
                    egui::Grid::new("history-grid")
                        .num_columns(5)
                        .spacing([8.0, 4.0])
                        .striped(true)
                        .show(ui, |ui| {
                            ui.label(egui::RichText::new("机器码").small().strong());
                            ui.label(egui::RichText::new("客户名").small().strong());
                            ui.label(egui::RichText::new("过期").small().strong());
                            ui.label(egui::RichText::new("签发时间").small().strong());
                            ui.label(egui::RichText::new("操作").small().strong());
                            ui.end_row();

                            for record in &self.history {
                                ui.label(egui::RichText::new(&record.machine).small().monospace());
                                ui.label(egui::RichText::new(if record.name.is_empty() { "-" } else { &record.name }).small());
                                ui.label(egui::RichText::new(if record.expires.is_empty() { "永久" } else { &record.expires }).small());
                                ui.label(egui::RichText::new(&record.issued_at).small());
                                if ui.small_button("复制").clicked() {
                                    let _ = arboard::Clipboard::new().and_then(|mut c| c.set_text(record.token.clone()));
                                }
                                ui.end_row();
                            }
                        });
                });
            }
        });
    }
}

// ---------------- helpers ----------------

fn history_path(key_path: &Path) -> PathBuf {
    key_path.parent()
        .map(|dir| dir.join(HISTORY_FILE_NAME))
        .unwrap_or_else(|| PathBuf::from(HISTORY_FILE_NAME))
}

fn load_history(key_path: &Path) -> Vec<LicenseRecord> {
    let path = history_path(key_path);
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

fn save_history(key_path: &Path, history: &[LicenseRecord]) {
    let path = history_path(key_path);
    if let Ok(json) = serde_json::to_string_pretty(history) {
        let _ = std::fs::write(&path, json);
    }
}

fn chrono_now() -> String {
    use std::time::SystemTime;
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // 简单格式化为 YYYY-MM-DD HH:MM
    let secs_per_day = 86400u64;
    let days = now / secs_per_day;
    let time_of_day = now % secs_per_day;
    let hours = (time_of_day / 3600 + 8) % 24; // UTC+8
    let minutes = (time_of_day % 3600) / 60;

    // 简化日期计算
    let mut y = 1970i64;
    let mut remaining_days = days as i64;
    loop {
        let days_in_year = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        y += 1;
    }
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let month_days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut m = 0usize;
    for (i, &md) in month_days.iter().enumerate() {
        if remaining_days < md as i64 {
            m = i + 1;
            break;
        }
        remaining_days -= md as i64;
    }
    let d = remaining_days + 1;

    format!("{:04}-{:02}-{:02} {:02}:{:02}", y, m, d, hours, minutes)
}

fn locate_default_private_key() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join("license_private_key.hex");
            if candidate.exists() {
                return candidate;
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let candidates = [
            cwd.join("tools/license-signer/keys/license_private_key.hex"),
            cwd.join("../tools/license-signer/keys/license_private_key.hex"),
            cwd.join("../../tools/license-signer/keys/license_private_key.hex"),
            cwd.join("license_private_key.hex"),
        ];
        for candidate in candidates {
            if candidate.exists() {
                return candidate;
            }
        }
    }
    PathBuf::from("license_private_key.hex")
}

fn load_signing_key(path: &Path) -> Result<SigningKey> {
    if !path.exists() {
        bail!("文件不存在: {}", path.display());
    }
    let raw = std::fs::read_to_string(path).context("读取私钥文件失败")?;
    let bytes = hex::decode(raw.trim()).context("私钥不是合法 hex 字符串")?;
    if bytes.len() != SECRET_KEY_LENGTH {
        bail!("私钥长度错误（期望 {SECRET_KEY_LENGTH} 字节）");
    }
    let mut arr = [0u8; SECRET_KEY_LENGTH];
    arr.copy_from_slice(&bytes);
    Ok(SigningKey::from_bytes(&arr))
}

#[allow(dead_code)]
fn embed_public_key_check(signing: &SigningKey) -> VerifyingKey {
    signing.verifying_key()
}

fn optional_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn validate_date(date: &str) -> Result<()> {
    let parts: Vec<&str> = date.split('-').collect();
    if parts.len() != 3 {
        return Err(anyhow!("过期日期需为 YYYY-MM-DD 格式"));
    }
    let _y: u32 = parts[0]
        .parse()
        .map_err(|_| anyhow!("年份格式错误"))?;
    let m: u32 = parts[1]
        .parse()
        .map_err(|_| anyhow!("月份格式错误"))?;
    let d: u32 = parts[2]
        .parse()
        .map_err(|_| anyhow!("日期格式错误"))?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return Err(anyhow!("过期日期不合法"));
    }
    Ok(())
}

fn sanitize_filename(value: &str) -> String {
    if value.is_empty() {
        return "license".to_string();
    }
    value
        .chars()
        .map(|c| {
            if matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                c
            }
        })
        .collect()
}

fn configure_fonts(ctx: &egui::Context) {
    // Windows 中文字体优先使用系统已安装的字体，避免打包字体文件
    let mut fonts = egui::FontDefinitions::default();
    let candidates: &[&str] = &[
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/msyh.ttf",
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/simsun.ttc",
        "/System/Library/Fonts/PingFang.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    ];
    for path in candidates {
        if let Ok(bytes) = std::fs::read(path) {
            fonts
                .font_data
                .insert("system-cjk".into(), egui::FontData::from_owned(bytes));
            for family in [egui::FontFamily::Proportional, egui::FontFamily::Monospace] {
                fonts
                    .families
                    .entry(family)
                    .or_default()
                    .insert(0, "system-cjk".into());
            }
            break;
        }
    }
    ctx.set_fonts(fonts);
}

fn main() -> eframe::Result<()> {
    let viewport = egui::ViewportBuilder::default()
        .with_inner_size([720.0, 560.0])
        .with_min_inner_size([640.0, 480.0])
        .with_title(APP_TITLE);
    let options = eframe::NativeOptions {
        viewport,
        ..Default::default()
    };
    eframe::run_native(APP_TITLE, options, Box::new(|cc| Ok(Box::new(App::new(cc)))))
}
