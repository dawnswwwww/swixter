use std::path::Path;
use std::process::Command;

/// 决策点 3：UI 产物的规范位置是 crate 内的 ui_dist（vite outDir 直出，
/// rust-embed 嵌入源，随 cargo package/publish 打包）。
/// index.html 缺失或仍是占位（含 PLACEHOLDER_MARKER）时尝试
/// bun install && bun run build；构建后若产物落在旧位置 ../../ui/dist
/// 则同步进 ui_dist（本地开发兼容）；bun 不可用或构建失败才写占位
/// index.html 并 warn（不阻断编译）。已提交/已构建的真实 UI 一律不动，
/// 保持工作区干净。
fn main() {
    let dist_index = Path::new("ui_dist/index.html");
    println!("cargo:rerun-if-changed=ui_dist");
    // 真实 UI（已提交或已构建）：直接使用，不重写任何文件
    if !is_placeholder_or_missing(dist_index) {
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
    // 本地开发兼容：bun 构建产物落在旧位置 ../../ui/dist 时同步到 ui_dist
    let legacy_dist = Path::new("../../ui/dist");
    if ok && is_placeholder_or_missing(dist_index) && legacy_dist.join("index.html").exists() {
        sync_dir(legacy_dist, Path::new("ui_dist"));
    }
    // 仍无真实 UI → 写占位（内容相同则跳过，避免 mtime 抖动触发重复构建）
    if is_placeholder_or_missing(dist_index) {
        let placeholder = placeholder_html();
        if std::fs::read_to_string(dist_index).ok().as_deref() != Some(placeholder.as_str()) {
            println!(
                "cargo:warning=crates/server/ui_dist missing and auto-build failed; \
                 embedding placeholder index.html. \
                 Run: cd packages/cli/ui && bun install && bun run build"
            );
            std::fs::create_dir_all("ui_dist").expect("create ui_dist");
            std::fs::write(dist_index, placeholder).expect("write placeholder index.html");
        }
    }
}

/// 占位文件可识别 marker：含 marker 的 index.html 视为占位，下次构建重试 bun build
const PLACEHOLDER_MARKER: &str = "<!-- swixter:placeholder-ui -->";

fn placeholder_html() -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Swixter</title></head>\
         <body>{PLACEHOLDER_MARKER}<p>Swixter UI assets are not built. Run \
         <code>cd packages/cli/ui && bun install && bun run build</code> first.</p></body></html>",
    )
}

/// index.html 缺失或内容含占位 marker → 需要（重）建
fn is_placeholder_or_missing(index: &Path) -> bool {
    match std::fs::read_to_string(index) {
        Ok(content) => content.contains(PLACEHOLDER_MARKER),
        Err(_) => true,
    }
}

/// 递归同步目录内容（仅拷贝文件；ui 产物无嵌套层级之外的形态）
fn sync_dir(src: &Path, dst: &Path) {
    std::fs::create_dir_all(dst).expect("create ui_dist");
    for entry in std::fs::read_dir(src).expect("read ui/dist") {
        let entry = entry.expect("read dir entry");
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            sync_dir(&from, &to);
        } else {
            std::fs::copy(&from, &to).expect("copy ui asset");
        }
    }
}
