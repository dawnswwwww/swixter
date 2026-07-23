//! 临时存根（Task 11），Task 12 替换为真实实现。
use crate::cli::RunArgs;
use crate::EXIT_GENERAL;
use swixter_core::coder::CoderSpec;

pub fn run(_coder: &CoderSpec, _args: RunArgs) -> i32 {
    eprintln!("not implemented yet");
    EXIT_GENERAL
}
