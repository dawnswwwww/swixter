use crate::{EXIT_GENERAL, EXIT_SUCCESS};
use std::path::Path;
use swixter_core::config::ConfigManager;
use swixter_core::export;

pub fn export_cmd(file: &Path) -> i32 {
    let mgr = ConfigManager::load();
    // TS 顶层 export 固定 sanitizeKeys=false（--sanitize 是死参数）
    match export::export_config(mgr.config(), file, false, None) {
        Ok(()) => {
            println!("✓ Exported to {}", file.display());
            EXIT_SUCCESS
        }
        Err(e) => {
            eprintln!("✗ {e}");
            EXIT_GENERAL
        }
    }
}

pub fn import_cmd(file: &Path) -> i32 {
    let mut mgr = ConfigManager::load();
    // TS 顶层 import 固定 overwrite=false, skipSanitized=true
    match export::import_config(&mut mgr, file, false, true) {
        Ok(stats) => {
            // 计划测试断言小写 "imported"，此处对齐（TS 原版为 "Successfully imported: N items"）
            println!("✓ imported: {}, skipped: {}", stats.imported, stats.skipped);
            for e in &stats.errors {
                eprintln!("  error: {e}");
            }
            EXIT_SUCCESS
        }
        Err(e) => {
            eprintln!("✗ {e}");
            EXIT_GENERAL
        }
    }
}
