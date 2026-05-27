// Storyboard Copilot License Signer
//
// 用法：
//   keygen                                生成 Ed25519 密钥对，写入 ./keys/
//   issue --machine <ID> [--name <NAME>] [--expires YYYY-MM-DD] [--out <FILE>]
//                                          为指定机器码签发授权令牌
//   verify --token <TOKEN>                 在签发机上自校验
//
// 安全要点：
//   - 私钥（license_private_key.hex）严禁分发，建议加密备份
//   - 公钥（license_public_key.hex）拷贝到 src-tauri/keys/ 后随项目一起编译进 exe
//   - 签出的 token 直接发给客户，客户在软件 "激活" 输入框中粘贴

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use anyhow::{anyhow, bail, Context, Result};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use ed25519_dalek::{Signer, SigningKey, VerifyingKey, SECRET_KEY_LENGTH};
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};

const LICENSE_PREFIX: &str = "SBLIC1-";

#[derive(Debug, Serialize, Deserialize)]
struct LicensePayload {
    #[serde(rename = "m")]
    machine: String,
    #[serde(rename = "e", skip_serializing_if = "Option::is_none")]
    expires: Option<String>,
    #[serde(rename = "n", skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let Some(command) = args.next() else {
        print_usage();
        return ExitCode::from(1);
    };

    let result = match command.as_str() {
        "keygen" => cmd_keygen(args.collect()),
        "issue" => cmd_issue(args.collect()),
        "verify" => cmd_verify(args.collect()),
        "help" | "--help" | "-h" => {
            print_usage();
            Ok(())
        }
        other => Err(anyhow!("unknown command: {other}")),
    };

    match result {
        Ok(_) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("error: {err:#}");
            ExitCode::from(1)
        }
    }
}

fn print_usage() {
    eprintln!(
        "Storyboard Copilot license signer\n\n\
         USAGE:\n  \
           license-signer keygen [--out-dir <DIR>] [--force]\n  \
           license-signer issue --machine <ID> [--name <NAME>] [--expires YYYY-MM-DD] \
                              [--key <PRIVATE_KEY_HEX_FILE>] [--out <FILE>]\n  \
           license-signer verify --token <TOKEN> [--machine <ID>] [--key <PUBLIC_KEY_HEX_FILE>]"
    );
}

fn cmd_keygen(args: Vec<String>) -> Result<()> {
    let mut out_dir: PathBuf = PathBuf::from("keys");
    let mut force = false;
    let mut iter = args.into_iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--out-dir" => out_dir = iter.next().context("--out-dir 缺少值")?.into(),
            "--force" => force = true,
            other => bail!("未知参数: {other}"),
        }
    }

    std::fs::create_dir_all(&out_dir)
        .with_context(|| format!("创建目录失败: {}", out_dir.display()))?;
    let priv_path = out_dir.join("license_private_key.hex");
    let pub_path = out_dir.join("license_public_key.hex");

    if !force && (priv_path.exists() || pub_path.exists()) {
        bail!(
            "目标目录已经存在密钥文件，加 --force 才允许覆盖：\n  {}\n  {}",
            priv_path.display(),
            pub_path.display()
        );
    }

    let mut secret_bytes = [0u8; SECRET_KEY_LENGTH];
    OsRng.fill_bytes(&mut secret_bytes);
    let signing = SigningKey::from_bytes(&secret_bytes);
    let verifying = signing.verifying_key();

    std::fs::write(&priv_path, hex::encode(secret_bytes))?;
    std::fs::write(&pub_path, hex::encode(verifying.to_bytes()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&priv_path)?.permissions();
        perms.set_mode(0o600);
        std::fs::set_permissions(&priv_path, perms)?;
    }

    println!("已生成密钥对：");
    println!("  私钥（请秘密保存）: {}", priv_path.display());
    println!("  公钥（嵌入应用）  : {}", pub_path.display());
    println!();
    println!(
        "下一步：把 {} 复制到 src-tauri/keys/license_public_key.hex 后再 build。",
        pub_path.display()
    );
    Ok(())
}

fn cmd_issue(args: Vec<String>) -> Result<()> {
    let mut machine: Option<String> = None;
    let mut name: Option<String> = None;
    let mut expires: Option<String> = None;
    let mut key_path: PathBuf = PathBuf::from("keys/license_private_key.hex");
    let mut out_path: Option<PathBuf> = None;
    let mut iter = args.into_iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--machine" => machine = Some(iter.next().context("--machine 缺少值")?),
            "--name" => name = Some(iter.next().context("--name 缺少值")?),
            "--expires" => expires = Some(iter.next().context("--expires 缺少值")?),
            "--key" => key_path = PathBuf::from(iter.next().context("--key 缺少值")?),
            "--out" => out_path = Some(PathBuf::from(iter.next().context("--out 缺少值")?)),
            other => bail!("未知参数: {other}"),
        }
    }

    let machine = machine.ok_or_else(|| anyhow!("必须提供 --machine <机器码>"))?;
    let signing = load_signing_key(&key_path)?;

    if let Some(date) = expires.as_deref() {
        validate_date(date)?;
    }

    let payload = LicensePayload {
        machine: machine.trim().to_string(),
        expires: expires.map(|s| s.trim().to_string()),
        name: name.map(|s| s.trim().to_string()),
    };
    let payload_bytes = serde_json::to_vec(&payload)?;
    let signature = signing.sign(&payload_bytes);

    let token = format!(
        "{}{}.{}",
        LICENSE_PREFIX,
        URL_SAFE_NO_PAD.encode(&payload_bytes),
        URL_SAFE_NO_PAD.encode(signature.to_bytes()),
    );

    if let Some(path) = &out_path {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }
        std::fs::write(path, &token)?;
        eprintln!("授权码已写入 {}", path.display());
    }

    println!("{token}");
    Ok(())
}

fn cmd_verify(args: Vec<String>) -> Result<()> {
    let mut token: Option<String> = None;
    let mut machine: Option<String> = None;
    let mut key_path: PathBuf = PathBuf::from("keys/license_public_key.hex");
    let mut iter = args.into_iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--token" => token = Some(iter.next().context("--token 缺少值")?),
            "--machine" => machine = Some(iter.next().context("--machine 缺少值")?),
            "--key" => key_path = PathBuf::from(iter.next().context("--key 缺少值")?),
            other => bail!("未知参数: {other}"),
        }
    }
    let token = token.ok_or_else(|| anyhow!("必须提供 --token"))?;
    let body = token
        .trim()
        .strip_prefix(LICENSE_PREFIX)
        .ok_or_else(|| anyhow!("授权码缺少前缀 {LICENSE_PREFIX}"))?;
    let (payload_b64, signature_b64) = body
        .split_once('.')
        .ok_or_else(|| anyhow!("授权码缺少签名分隔符"))?;
    let payload_bytes = URL_SAFE_NO_PAD.decode(payload_b64.as_bytes())?;
    let signature_bytes = URL_SAFE_NO_PAD.decode(signature_b64.as_bytes())?;

    let pub_hex = std::fs::read_to_string(&key_path)
        .with_context(|| format!("读取公钥文件失败: {}", key_path.display()))?;
    let pub_bytes = hex::decode(pub_hex.trim())?;
    let pub_arr: [u8; 32] = pub_bytes
        .as_slice()
        .try_into()
        .map_err(|_| anyhow!("公钥长度必须为 32 字节"))?;
    let verifying = VerifyingKey::from_bytes(&pub_arr)?;

    let sig_arr: [u8; 64] = signature_bytes
        .as_slice()
        .try_into()
        .map_err(|_| anyhow!("签名长度必须为 64 字节"))?;
    let signature = ed25519_dalek::Signature::from_bytes(&sig_arr);

    verifying.verify_strict(&payload_bytes, &signature)?;
    let payload: LicensePayload = serde_json::from_slice(&payload_bytes)?;
    if let Some(expected) = machine.as_deref() {
        if expected != payload.machine {
            bail!(
                "机器码不匹配：授权机器={}, 期望={}",
                payload.machine,
                expected
            );
        }
    }
    println!("授权码验证通过");
    println!("  machine : {}", payload.machine);
    if let Some(name) = &payload.name {
        println!("  name    : {}", name);
    }
    if let Some(expires) = &payload.expires {
        println!("  expires : {}", expires);
    } else {
        println!("  expires : 永久");
    }
    Ok(())
}

fn load_signing_key(path: &Path) -> Result<SigningKey> {
    let raw = std::fs::read_to_string(path)
        .with_context(|| format!("读取私钥文件失败: {}", path.display()))?;
    let bytes = hex::decode(raw.trim()).context("私钥必须为 hex 字符串")?;
    if bytes.len() != SECRET_KEY_LENGTH {
        bail!("私钥长度必须为 {SECRET_KEY_LENGTH} 字节");
    }
    let mut arr = [0u8; SECRET_KEY_LENGTH];
    arr.copy_from_slice(&bytes);
    Ok(SigningKey::from_bytes(&arr))
}

fn validate_date(date: &str) -> Result<()> {
    let parts: Vec<&str> = date.split('-').collect();
    if parts.len() != 3 {
        bail!("过期日期需为 YYYY-MM-DD: {date}");
    }
    let _y: u32 = parts[0].parse().context("年份格式错误")?;
    let m: u32 = parts[1].parse().context("月份格式错误")?;
    let d: u32 = parts[2].parse().context("日期格式错误")?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        bail!("过期日期不合法: {date}");
    }
    Ok(())
}
