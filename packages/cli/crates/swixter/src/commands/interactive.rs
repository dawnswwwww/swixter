//! 临时存根（Task 11），Task 14 替换为 dialoguer 交互式菜单与向导。
use crate::cli::CreateArgs;
use crate::EXIT_GENERAL;
use swixter_core::coder::CoderSpec;

pub fn main_menu(_coder: &CoderSpec) -> i32 {
    eprintln!("not implemented yet");
    EXIT_GENERAL
}

pub fn create_wizard(_coder: &CoderSpec, _args: CreateArgs) -> i32 {
    eprintln!("not implemented yet");
    EXIT_GENERAL
}

pub fn edit_wizard(_coder: &CoderSpec, _name: Option<String>) -> i32 {
    eprintln!("not implemented yet");
    EXIT_GENERAL
}
