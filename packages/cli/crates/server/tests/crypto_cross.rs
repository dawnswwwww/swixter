use swixter_server::crypto::{derive::*, encrypt::*};

#[test]
fn pbkdf2_matches_fixed_vector() {
    // 与 WebCrypto PBKDF2-HMAC-SHA256(100k) 对齐的固定向量
    let key = derive_key("correct horse battery staple", "AAECAwQFBgcICQoLDA0ODw==");
    assert_eq!(key_to_base64(&key).len(), 44); // 32 字节 → base64 44 字符
                                               // hex 断言值由 gen-crypto-fixtures.ts 首次运行时打印后填入（双向锚定）
    assert_eq!(
        key.iter().map(|b| format!("{b:02x}")).collect::<String>(),
        "49d49c25f597846209f0d92e7770ab64e1c75e94b4ce6c509265ee67175d2a1e"
    );
}

#[test]
fn decrypts_ts_generated_vectors() {
    let raw = include_str!("fixtures/crypto_ts_vectors.json");
    let v: serde_json::Value = serde_json::from_str(raw).unwrap();
    let key = key_from_base64(v["keyBase64"].as_str().unwrap()).unwrap();
    // 派生一致性：TS 端用 password+salt derive，Rust 端重新 derive 必须得到同一 key
    let derived = derive_key(
        v["password"].as_str().unwrap(),
        v["saltBase64"].as_str().unwrap(),
    );
    assert_eq!(derived, key);
    for case in v["cases"].as_array().unwrap() {
        let pt = case["plaintext"].as_str().unwrap();
        let ct = case["ciphertext"].as_str().unwrap();
        assert_eq!(decrypt(&key, ct).unwrap(), pt, "TS→Rust 解密失败: {ct}");
        // round-trip：Rust 加密 → Rust 解密
        let re = encrypt(&key, pt).unwrap();
        assert_eq!(decrypt(&key, &re).unwrap(), pt);
    }
}

#[test]
fn rust_encrypt_ts_decrypt_cross_check() {
    // 无 bun 环境跳过；有 bun 时 Rust 生成向量 → TS WebCrypto 解密验证
    if std::process::Command::new("bun")
        .arg("--version")
        .output()
        .is_err()
    {
        eprintln!("skip: bun not available");
        return;
    }
    let raw = include_str!("fixtures/crypto_ts_vectors.json");
    let v: serde_json::Value = serde_json::from_str(raw).unwrap();
    let key = key_from_base64(v["keyBase64"].as_str().unwrap()).unwrap();
    let cases: Vec<_> = v["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| {
            let pt = c["plaintext"].as_str().unwrap();
            serde_json::json!({"plaintext": pt, "ciphertext": encrypt(&key, pt).unwrap()})
        })
        .collect();
    let out = serde_json::json!({"keyBase64": v["keyBase64"], "cases": cases});
    let tmp =
        std::env::temp_dir().join(format!("swixter-rust-vectors-{}.json", std::process::id()));
    std::fs::write(&tmp, serde_json::to_string(&out).unwrap()).unwrap();
    let status = std::process::Command::new("bun")
        .args([
            "run",
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../scripts/verify-crypto-fixtures.ts"
            ),
        ])
        .arg(&tmp)
        .status()
        .unwrap();
    std::fs::remove_file(&tmp).ok();
    assert!(status.success(), "Rust→TS 解密验证失败");
}
