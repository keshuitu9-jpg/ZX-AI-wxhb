// icon-roundifier
//
// 给方形图标打一个圆形 alpha 遮罩，把圆外的像素设为透明。
// 用法：icon-roundifier <input.png> <output.png> [--inset 0.0]
//   --inset 0.02 表示在图像边缘内缩 2% 作为圆的边界，避免圆紧贴边

use std::path::PathBuf;

use anyhow::{anyhow, bail, Context, Result};
use image::{ImageBuffer, Rgba};

fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let input = args
        .next()
        .ok_or_else(|| anyhow!("缺少输入文件路径"))?;
    let output = args
        .next()
        .ok_or_else(|| anyhow!("缺少输出文件路径"))?;
    let mut inset = 0.0f32;
    while let Some(opt) = args.next() {
        match opt.as_str() {
            "--inset" => {
                let v = args
                    .next()
                    .ok_or_else(|| anyhow!("--inset 缺少值"))?;
                inset = v.parse().context("--inset 需要浮点数")?;
            }
            other => bail!("未知参数: {other}"),
        }
    }

    let input_path = PathBuf::from(&input);
    let output_path = PathBuf::from(&output);

    let img = image::open(&input_path)
        .with_context(|| format!("打开输入图片失败: {}", input_path.display()))?;
    let mut rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let cx = (w as f32 - 1.0) * 0.5;
    let cy = (h as f32 - 1.0) * 0.5;
    let radius = (w.min(h) as f32 * 0.5) * (1.0 - inset.max(0.0));
    let edge = 0.75f32; // 抗锯齿过渡宽度（像素）

    let masked: ImageBuffer<Rgba<u8>, Vec<u8>> =
        ImageBuffer::from_fn(w, h, |x, y| {
            let pixel = rgba.get_pixel(x, y);
            let dx = x as f32 - cx;
            let dy = y as f32 - cy;
            let dist = (dx * dx + dy * dy).sqrt();
            let alpha_factor = if dist <= radius - edge {
                1.0
            } else if dist >= radius {
                0.0
            } else {
                (radius - dist) / edge
            };
            let new_alpha = (pixel[3] as f32 * alpha_factor).round().clamp(0.0, 255.0) as u8;
            Rgba([pixel[0], pixel[1], pixel[2], new_alpha])
        });
    rgba = masked;

    if let Some(parent) = output_path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).ok();
        }
    }
    rgba.save(&output_path)
        .with_context(|| format!("写出图片失败: {}", output_path.display()))?;

    println!(
        "已写出 {} ({}x{})",
        output_path.display(),
        rgba.width(),
        rgba.height()
    );
    Ok(())
}
