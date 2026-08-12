use assert_cmd::Command;
use predicates::prelude::*;

#[test]
fn version_prints() {
    Command::cargo_bin("swixter")
        .unwrap()
        .arg("--version")
        .assert()
        .success()
        .stdout(predicate::str::contains("swixter"));
}

#[test]
fn unknown_command_exits_2() {
    Command::cargo_bin("swixter")
        .unwrap()
        .arg("bogus")
        .assert()
        .code(2);
}

#[test]
fn completion_bash_outputs_script() {
    Command::cargo_bin("swixter")
        .unwrap()
        .args(["completion", "bash"])
        .assert()
        .success()
        .stdout(predicate::str::contains("swixter"));
}

#[test]
fn version_subcommand_prints_full_block() {
    // TS cmdVersion：version 子命令输出完整信息块并 exit 0
    Command::cargo_bin("swixter")
        .unwrap()
        .arg("version")
        .assert()
        .success()
        .stdout(predicate::str::contains("Version:"))
        .stdout(predicate::str::contains("Config Version:"))
        .stdout(predicate::str::contains("Export Version:"));
}

#[test]
fn short_v_flag_prints_full_block() {
    // TS: -v 与 version 子命令一致（完整信息块，exit 0）
    Command::cargo_bin("swixter")
        .unwrap()
        .arg("-v")
        .assert()
        .success()
        .stdout(predicate::str::contains("Config Version:"));
}
