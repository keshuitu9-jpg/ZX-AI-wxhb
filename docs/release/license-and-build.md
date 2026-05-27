# 加密发布与授权签发流程

本文是给你（发布者）看的操作手册。客户端的最终用户只会看到一个机器码 + 激活码输入框。

## 1. 安全模型一句话版

- 编译期把 Ed25519 **公钥**写进 exe；**私钥**只在你这台机器上。
- 客户启动应用 → 应用读 Windows MachineGuid 计算出**机器码**（16 位 Base32）。
- 客户把机器码发给你 → 你用私钥对该机器码签授权 → 回发授权码。
- 客户在激活页面粘贴授权码，应用本地用公钥验签，通过则写入 `app_data_dir/license.bin`。
- 验签失败、机器码不一致、过期 → 不允许进入主界面。

## 2. 一次性：生成密钥对（永久重要）

私钥丢了就所有客户都得重发；私钥泄露则有人能给自己签授权。**强烈建议加密备份**。

```bat
cargo run --manifest-path tools\license-signer\Cargo.toml -- keygen --out-dir tools\license-signer\keys
```

执行后会产出：
- `tools\license-signer\keys\license_private_key.hex` —— 私钥，只留你本机
- `tools\license-signer\keys\license_public_key.hex` —— 公钥，要嵌入 exe

把公钥复制到 Tauri 项目的指定位置：

```bat
copy /y tools\license-signer\keys\license_public_key.hex src-tauri\keys\license_public_key.hex
```

`build.rs` 在编译时会自动读取这个文件并写进 `STORYBOARD_LICENSE_PUBLIC_KEY` 环境变量。也可以临时用环境变量覆盖：

```bat
set STORYBOARD_LICENSE_PUBLIC_KEY=<64位hex公钥>
```

如果没配置任何来源，`build.rs` 会发出 `cargo:warning` 并嵌入全 0 公钥（**所有授权都会被拒绝**），是给本地纯 UI 调试用的，正式打包前请务必确认日志里没有这条警告。

## 3. 打包发布版 exe

```bat
npm install
npm run tauri build
```

产物在 `src-tauri\target\release\bundle\` 下：
- `msi\` —— 标准 Windows 安装包
- `nsis\` —— NSIS 安装包
- 也可以直接用 `src-tauri\target\release\storyboard-copilot.exe`

`Cargo.toml` 的 release profile 已经开了 `lto = fat`、`opt-level = "z"`、`codegen-units = 1`、`strip`，体积会更小、符号表会被剥离，相当于做了一层基础混淆。

> **可选 - 二进制加壳**：体积进一步压缩可以用 [UPX](https://upx.github.io/)，命令 `upx --best --lzma storyboard-copilot.exe`。注意 UPX 容易被部分杀毒软件误报，企业客户场景慎用。要做强反逆向得上 VMProtect/Themida 商用壳，单独再处理。

## 4. 给客户签授权码

客户提供机器码（形如 `ABCD-EFGH-IJKL-MNOP`）后：

```bat
:: 永久授权
cargo run --manifest-path tools\license-signer\Cargo.toml -- issue ^
  --machine ABCD-EFGH-IJKL-MNOP ^
  --name "客户A" ^
  --key tools\license-signer\keys\license_private_key.hex

:: 限期到 2026-12-31
cargo run --manifest-path tools\license-signer\Cargo.toml -- issue ^
  --machine ABCD-EFGH-IJKL-MNOP ^
  --name "客户A" ^
  --expires 2026-12-31 ^
  --key tools\license-signer\keys\license_private_key.hex ^
  --out licenses\客户A.lic
```

输出形如 `SBLIC1-eyJtIjoi...XYZ.AbCd...XyZ`。把这串发给客户即可。

可选自检：

```bat
cargo run --manifest-path tools\license-signer\Cargo.toml -- verify ^
  --token SBLIC1-... ^
  --machine ABCD-EFGH-IJKL-MNOP ^
  --key tools\license-signer\keys\license_public_key.hex
```

## 5. 客户端使用流程

1. 客户首次启动 → 进入"产品授权激活"页，看到机器码。
2. 把机器码发给你（通过任何通讯工具）。
3. 你按上面 `issue` 命令签授权码，回复给客户。
4. 客户粘贴到 textarea → 点"立即激活" → 通过验证后正常进入主界面。
5. 授权码会以原文存到 `%APPDATA%\storyboard-copilot\license.bin`，每次启动应用本地验签。

## 6. 常见问题

- **客户重装系统/换硬盘**：`MachineGuid` 改变 → 机器码会变 → 旧授权失效，需要重发。
- **Windows 更新换机器码**：极少见，但出现过；按照"重装"流程处理即可。
- **想给客户做"试用 7 天"**：`--expires` 设成 7 天后的日期。过期后 `check_license` 会返回 `授权已于 ... 过期` 并拦在激活页。
- **想吊销**：吊销名单（CRL）当前没有实现。短期解决方案是签限期授权；如需在线吊销列表，可后续加个 HTTPS 拉取。

## 7. 安全审计自查

- [ ] 私钥从未提交到 Git（`.gitignore` 已覆盖 `keys/`、`*.lic`）
- [ ] 私钥已加密备份到至少两个独立介质
- [ ] 签出来的授权码自检通过（`verify` 命令）
- [ ] 发布版 exe 启动后弹出激活页（确认编译进了正确的公钥，不是占位 0 公钥）
- [ ] 无授权情况下，所有命令调用都不会泄露画布数据（授权门是组件级，未授权时根本不渲染主界面）
