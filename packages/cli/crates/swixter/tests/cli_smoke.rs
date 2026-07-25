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
