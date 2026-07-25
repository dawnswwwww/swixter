use std::path::Path;
use std::process::Command;

/// 决策点 3：ui/dist 缺失时尝试 bun install && bun run build；
/// bun 不可用或构建失败则生成空占位 index.html 并 warn（不阻断编译）。
fn main() {
    let dist_index = Path::new("../../ui/dist/index.html");
    println!("cargo:rerun-if-changed=../../ui/dist");
    if dist_index.exists() {
        return;
    }
    let ok = Command::new("bun")
        .args(["install"])
        .current_dir("../../ui")
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
        && Command::new("bun")
            .args(["run", "build"])
            .current_dir("../../ui")
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
    if !ok || !dist_index.exists() {
        println!(
            "cargo:warning=packages/cli/ui/dist missing and auto-build failed; \
             embedding placeholder index.html. \
             Run: cd packages/cli/ui && bun install && bun run build"
        );
        std::fs::create_dir_all("../../ui/dist").expect("create ui/dist");
        std::fs::write(
            dist_index,
            "<!doctype html><html><head><meta charset=\"utf-8\"><title>Swixter</title></head>\
             <body><p>Swixter UI assets are not built. Run \
             <code>cd packages/cli/ui && bun install && bun run build</code> first.</p></body></html>",
        )
        .expect("write placeholder index.html");
    }
}
