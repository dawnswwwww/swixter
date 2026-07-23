// 用法: bun run scripts/export-data.ts
// 从 TS 源码导出内置 presets 与 install 配置为 JSON，供 Rust include_str! 嵌入。
import { builtInPresets } from "../src/providers/presets.js";
import { INSTALL_CONFIGS, UPDATE_COMMANDS } from "../src/constants/install.js";
import { writeFileSync } from "node:fs";

writeFileSync(
  new URL("../crates/core/src/presets.json", import.meta.url),
  JSON.stringify(builtInPresets, null, 2) + "\n"
);
writeFileSync(
  new URL("../crates/swixter/src/install.json", import.meta.url),
  JSON.stringify({ installConfigs: INSTALL_CONFIGS, updateCommands: UPDATE_COMMANDS }, null, 2) + "\n"
);
console.log(`exported ${builtInPresets.length} presets`);
