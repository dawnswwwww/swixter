//! 临时存根（Task 11），Task 13 替换为真实实现。
use crate::EXIT_GENERAL;
use swixter_core::coder::CoderSpec;

pub fn install(_coder: &CoderSpec, _method: Option<usize>, _force: bool) -> i32 {
    eprintln!("not implemented yet");
    EXIT_GENERAL
}

pub fn update(_coder: &CoderSpec) -> i32 {
    eprintln!("not implemented yet");
    EXIT_GENERAL
}
