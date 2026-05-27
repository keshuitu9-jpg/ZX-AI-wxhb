use std::path::PathBuf;

fn main() {
    embed_license_public_key();
    tauri_build::build();
}

/// 把签发授权用的 Ed25519 公钥（hex）注入到编译时的 STORYBOARD_LICENSE_PUBLIC_KEY 环境变量。
///
/// 优先级：
///   1. 环境变量 STORYBOARD_LICENSE_PUBLIC_KEY 已存在时直接使用
///   2. 否则尝试读取 src-tauri/keys/license_public_key.hex
///   3. 都没有则注入一个全 0 占位（无法验证任何授权，便于本地开发但禁止发布）
const ZERO_PUBLIC_KEY: &str = "0000000000000000000000000000000000000000000000000000000000000000";

fn embed_license_public_key() {
    println!("cargo:rerun-if-env-changed=STORYBOARD_LICENSE_PUBLIC_KEY");
    println!("cargo:rerun-if-changed=keys/license_public_key.hex");

    let from_env = std::env::var("STORYBOARD_LICENSE_PUBLIC_KEY").ok();
    let from_file = if from_env.is_none() {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."));
        let key_path = manifest_dir.join("keys").join("license_public_key.hex");
        std::fs::read_to_string(&key_path).ok()
    } else {
        None
    };

    let key = from_env
        .or(from_file)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            println!(
                "cargo:warning=License public key not configured (env STORYBOARD_LICENSE_PUBLIC_KEY \
                 or keys/license_public_key.hex). Built binary will reject every license. \
                 Run `cargo run -p license-signer -- keygen` to generate one before release."
            );
            ZERO_PUBLIC_KEY.to_string()
        });

    if key.len() != 64 || !key.chars().all(|c| c.is_ascii_hexdigit()) {
        panic!(
            "STORYBOARD_LICENSE_PUBLIC_KEY must be a 64-char hex string (Ed25519 public key); got length {}",
            key.len()
        );
    }

    println!("cargo:rustc-env=STORYBOARD_LICENSE_PUBLIC_KEY={}", key);
}
