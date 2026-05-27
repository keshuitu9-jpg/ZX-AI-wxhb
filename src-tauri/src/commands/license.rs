// 离线授权（License）模块
//
// 安全模型：
//   - 公钥（Ed25519）在编译期嵌入 exe，私钥只存在签发者本机
//   - 机器码 = SHA-256(MachineGuid + ComputerName) 截短为 80 bit，编码成 16 位 Base32
//   - 授权令牌格式：SBLIC1-<payload_b64>.<signature_b64>
//     payload 是 JSON：{ "m": "<machine>", "e": "YYYY-MM-DD" 或 null, "n": "<name>" }
//   - 激活后授权文件以二进制形式落到 app_data_dir/license.bin
//   - 启动时验签 + 校机器码 + 校过期，三者全过才算授权

use std::path::PathBuf;
use std::sync::OnceLock;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use data_encoding::BASE32_NOPAD;
use ed25519_dalek::{Signature, Verifier, VerifyingKey, PUBLIC_KEY_LENGTH, SIGNATURE_LENGTH};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Manager;

const LICENSE_PREFIX: &str = "SBLIC1-";
const LICENSE_FILE_NAME: &str = "license.bin";

// 公钥在编译期由 build.rs 写入；如果没配置环境变量，则用一个全 0 的占位（占位时所有授权都会拒绝）
const EMBEDDED_PUBLIC_KEY_HEX: &str = env!(
    "STORYBOARD_LICENSE_PUBLIC_KEY",
    "缺少 STORYBOARD_LICENSE_PUBLIC_KEY 环境变量，构建前请用 license-signer 生成密钥对"
);

fn verifying_key() -> &'static VerifyingKey {
    static KEY: OnceLock<VerifyingKey> = OnceLock::new();
    KEY.get_or_init(|| {
        let bytes = hex::decode(EMBEDDED_PUBLIC_KEY_HEX.trim())
            .expect("embedded public key must be valid hex");
        let arr: [u8; PUBLIC_KEY_LENGTH] = bytes
            .as_slice()
            .try_into()
            .expect("embedded public key must be 32 bytes");
        VerifyingKey::from_bytes(&arr).expect("embedded public key must be a valid Ed25519 key")
    })
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LicensePayload {
    /// 绑定的机器码
    #[serde(rename = "m")]
    pub machine: String,
    /// 过期日期 YYYY-MM-DD；缺省视为永久
    #[serde(rename = "e", skip_serializing_if = "Option::is_none")]
    pub expires: Option<String>,
    /// 客户名称（可选，仅展示用）
    #[serde(rename = "n", skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LicenseStatus {
    pub authorized: bool,
    pub machine_id: String,
    pub reason: Option<String>,
    pub licensed_to: Option<String>,
    pub expires: Option<String>,
}

/// 计算稳定的机器码：SHA-256(MachineGuid + ComputerName)，取前 10 字节，Base32 编码并以 4 位分组
fn compute_machine_id() -> Result<String, String> {
    let raw = collect_hardware_fingerprint()?;
    let mut hasher = Sha256::new();
    hasher.update(b"storyboard-copilot/license/v1\0");
    hasher.update(raw.as_bytes());
    let digest = hasher.finalize();
    let short = &digest[..10]; // 80 bit -> 16 chars Base32
    let encoded = BASE32_NOPAD.encode(short);
    // 分组：XXXX-XXXX-XXXX-XXXX
    Ok(encoded
        .as_bytes()
        .chunks(4)
        .map(|chunk| std::str::from_utf8(chunk).unwrap_or(""))
        .collect::<Vec<_>>()
        .join("-"))
}

#[cfg(target_os = "windows")]
fn collect_hardware_fingerprint() -> Result<String, String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let crypto = hklm
        .open_subkey("SOFTWARE\\Microsoft\\Cryptography")
        .map_err(|err| format!("read MachineGuid failed: {err}"))?;
    let machine_guid: String = crypto
        .get_value("MachineGuid")
        .map_err(|err| format!("MachineGuid value missing: {err}"))?;

    let computer_name = std::env::var("COMPUTERNAME").unwrap_or_default();
    Ok(format!("{}|{}", machine_guid, computer_name))
}

#[cfg(target_os = "macos")]
fn collect_hardware_fingerprint() -> Result<String, String> {
    use std::process::Command;

    let output = Command::new("ioreg")
        .args(["-rd1", "-c", "IOPlatformExpertDevice"])
        .output()
        .map_err(|err| format!("ioreg failed: {err}"))?;
    let text = String::from_utf8_lossy(&output.stdout);
    let uuid = text
        .lines()
        .find_map(|line| line.split("\"IOPlatformUUID\" = \"").nth(1))
        .and_then(|tail| tail.split('"').next())
        .unwrap_or("")
        .to_string();
    let host = std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("HOST"))
        .unwrap_or_default();
    Ok(format!("{}|{}", uuid, host))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn collect_hardware_fingerprint() -> Result<String, String> {
    let machine_id = std::fs::read_to_string("/etc/machine-id")
        .or_else(|_| std::fs::read_to_string("/var/lib/dbus/machine-id"))
        .map_err(|err| format!("read machine-id failed: {err}"))?;
    let host = std::env::var("HOSTNAME").unwrap_or_default();
    Ok(format!("{}|{}", machine_id.trim(), host))
}

fn license_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("app_data_dir not available: {err}"))?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|err| format!("create app_data_dir failed: {err}"))?;
    }
    Ok(dir.join(LICENSE_FILE_NAME))
}

fn parse_license_token(token: &str) -> Result<(LicensePayload, Vec<u8>, Vec<u8>), String> {
    let trimmed = token.trim();
    let body = trimmed
        .strip_prefix(LICENSE_PREFIX)
        .ok_or_else(|| "授权码格式不正确（缺少版本前缀）".to_string())?;
    let (payload_b64, signature_b64) = body
        .split_once('.')
        .ok_or_else(|| "授权码格式不正确（缺少签名分隔符）".to_string())?;

    let payload_bytes = URL_SAFE_NO_PAD
        .decode(payload_b64.as_bytes())
        .map_err(|err| format!("授权载荷解码失败: {err}"))?;
    let signature_bytes = URL_SAFE_NO_PAD
        .decode(signature_b64.as_bytes())
        .map_err(|err| format!("授权签名解码失败: {err}"))?;

    let payload: LicensePayload = serde_json::from_slice(&payload_bytes)
        .map_err(|err| format!("授权载荷不是合法 JSON: {err}"))?;
    Ok((payload, payload_bytes, signature_bytes))
}

fn verify_signature(payload_bytes: &[u8], signature_bytes: &[u8]) -> Result<(), String> {
    if signature_bytes.len() != SIGNATURE_LENGTH {
        return Err("授权签名长度不正确".to_string());
    }
    let mut sig_arr = [0u8; SIGNATURE_LENGTH];
    sig_arr.copy_from_slice(signature_bytes);
    let signature = Signature::from_bytes(&sig_arr);
    verifying_key()
        .verify(payload_bytes, &signature)
        .map_err(|_| "授权签名验证失败".to_string())
}

fn check_expiry(expires: Option<&str>) -> Result<(), String> {
    let Some(date) = expires else {
        return Ok(());
    };
    // 允许 YYYY-MM-DD；逐位手工比较，避免引入 chrono
    let parts: Vec<&str> = date.split('-').collect();
    if parts.len() != 3 {
        return Err(format!("授权过期日期格式错误: {date}"));
    }
    let y: u64 = parts[0].parse().map_err(|_| "授权过期日期格式错误")?;
    let m: u64 = parts[1].parse().map_err(|_| "授权过期日期格式错误")?;
    let d: u64 = parts[2].parse().map_err(|_| "授权过期日期格式错误")?;
    let exp_ord = y * 10_000 + m * 100 + d;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|err| format!("system time error: {err}"))?
        .as_secs();
    let (today_y, today_m, today_d) = unix_to_ymd(now);
    let today_ord = today_y * 10_000 + today_m * 100 + today_d;
    if today_ord > exp_ord {
        return Err(format!("授权已于 {date} 过期"));
    }
    Ok(())
}

/// 根据 Unix 时间戳粗略折算 Y/M/D（UTC）。够用，不引入 chrono。
fn unix_to_ymd(seconds: u64) -> (u64, u64, u64) {
    let days = seconds / 86_400;
    // 1970-01-01 是星期四，但我们只需要日历日，参考 Howard Hinnant 的 days_from_civil 反向算法
    let z = days as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as u64, m, d)
}

fn evaluate_token(token: &str, machine_id: &str) -> Result<LicensePayload, String> {
    let (payload, payload_bytes, signature_bytes) = parse_license_token(token)?;
    verify_signature(&payload_bytes, &signature_bytes)?;
    if payload.machine.trim() != machine_id {
        return Err("授权码与本机机器码不匹配".to_string());
    }
    check_expiry(payload.expires.as_deref())?;
    Ok(payload)
}

#[tauri::command]
pub fn get_machine_id() -> Result<String, String> {
    compute_machine_id()
}

#[tauri::command]
pub fn check_license(app: tauri::AppHandle) -> LicenseStatus {
    let machine_id = match compute_machine_id() {
        Ok(value) => value,
        Err(err) => {
            return LicenseStatus {
                authorized: false,
                machine_id: String::new(),
                reason: Some(format!("无法读取机器码: {err}")),
                licensed_to: None,
                expires: None,
            };
        }
    };

    let path = match license_path(&app) {
        Ok(value) => value,
        Err(err) => {
            return LicenseStatus {
                authorized: false,
                machine_id,
                reason: Some(err),
                licensed_to: None,
                expires: None,
            };
        }
    };

    if !path.exists() {
        return LicenseStatus {
            authorized: false,
            machine_id,
            reason: Some("尚未激活".to_string()),
            licensed_to: None,
            expires: None,
        };
    }

    let token = match std::fs::read_to_string(&path) {
        Ok(value) => value,
        Err(err) => {
            return LicenseStatus {
                authorized: false,
                machine_id,
                reason: Some(format!("读取授权文件失败: {err}")),
                licensed_to: None,
                expires: None,
            };
        }
    };

    match evaluate_token(token.trim(), &machine_id) {
        Ok(payload) => LicenseStatus {
            authorized: true,
            machine_id,
            reason: None,
            licensed_to: payload.name,
            expires: payload.expires,
        },
        Err(err) => LicenseStatus {
            authorized: false,
            machine_id,
            reason: Some(err),
            licensed_to: None,
            expires: None,
        },
    }
}

#[tauri::command]
pub fn activate_license(app: tauri::AppHandle, token: String) -> Result<LicenseStatus, String> {
    let machine_id = compute_machine_id()?;
    let payload = evaluate_token(token.trim(), &machine_id)?;
    let path = license_path(&app)?;
    std::fs::write(&path, token.trim().as_bytes())
        .map_err(|err| format!("写入授权文件失败: {err}"))?;
    Ok(LicenseStatus {
        authorized: true,
        machine_id,
        reason: None,
        licensed_to: payload.name,
        expires: payload.expires,
    })
}

#[tauri::command]
pub fn deactivate_license(app: tauri::AppHandle) -> Result<(), String> {
    let path = license_path(&app)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|err| format!("删除授权文件失败: {err}"))?;
    }
    Ok(())
}
