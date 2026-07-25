//! @clack/prompts 风格的交互主题（对齐 TS 版 CLI 的 TUI 观感）。
//!
//! dialoguer 0.11 的 ColorfulTheme 本身就有双态前缀：`prompt_prefix` 用于
//! prompt 激活中（format_prompt / format_input_prompt / ...），`success_prefix`
//! 用于提交后的回显行（format_*_selection）。因此不需要自定义 Theme trait，
//! 定制 ColorfulTheme 字段即可表达 clack 的 "激活 ◆（cyan）/ 完成 ◇（dim）" 双态。
//!
//! 左侧 `│` 竖线导轨 dialoguer 无法逐行绘制，由 print_header / print_rail /
//! print_step_done 在 wizard 各步之间补印。
use console::{style, Style};
use dialoguer::theme::ColorfulTheme;

/// clack 风格主题：激活 ◆ cyan、完成 ◇ dim、错误 ▲ red、选项 ● cyan / ○ dim
pub fn swixter_theme() -> ColorfulTheme {
    ColorfulTheme {
        prompt_prefix: style("◆".to_string()).for_stderr().cyan(),
        success_prefix: style("◇".to_string()).for_stderr().dim(),
        error_prefix: style("▲".to_string()).for_stderr().red(),
        prompt_suffix: style("".to_string()).for_stderr(),
        success_suffix: style("".to_string()).for_stderr(),
        prompt_style: Style::new().for_stderr().bold(),
        error_style: Style::new().for_stderr().red(),
        hint_style: Style::new().for_stderr().dim(),
        // 提交后回显的答案值：cyan（clack 的 answer 颜色）
        values_style: Style::new().for_stderr().cyan(),
        defaults_style: Style::new().for_stderr().dim(),
        // Select/MultiSelect/Sort 选项：选中 ● cyan、未选 ○ dim
        active_item_prefix: style("●".to_string()).for_stderr().cyan(),
        inactive_item_prefix: style("○".to_string()).for_stderr().dim(),
        active_item_style: Style::new().for_stderr().cyan(),
        inactive_item_style: Style::new().for_stderr().dim(),
        checked_item_prefix: style("●".to_string()).for_stderr().cyan(),
        unchecked_item_prefix: style("○".to_string()).for_stderr().dim(),
        picked_item_prefix: style("●".to_string()).for_stderr().cyan(),
        unpicked_item_prefix: style("○".to_string()).for_stderr().dim(),
    }
}

/// 打印交互区标题：bold 标题行 + 空行 + `│` 导轨起始行
pub fn print_header(title: &str) {
    eprintln!();
    eprintln!("{}", Style::new().for_stderr().bold().apply_to(title));
    eprintln!();
    print_rail();
}

/// 打印一行 `│` 导轨（dim），用于 wizard 各步之间的分隔
pub fn print_rail() {
    eprintln!("{}", Style::new().for_stderr().dim().apply_to("│"));
}

/// 打印 `◇  <msg>`（dim 前缀）步骤完成回显，用于非 prompt 的步骤收尾
pub fn print_step_done(msg: &str) {
    eprintln!("{}  {}", Style::new().for_stderr().dim().apply_to("◇"), msg);
}
