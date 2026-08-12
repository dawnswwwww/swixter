use base64::{engine::general_purpose::STANDARD as B64, Engine};
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use sha2::Sha256;

use crate::{ServerError, PBKDF2_ITERATIONS, SALT_LEN};

/// TS: crypto/derive.ts generateSalt —— 16 字节随机 → base64
pub fn generate_salt() -> String {
    let mut salt = [0u8; SALT_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    B64.encode(salt)
}

/// TS: deriveKey —— PBKDF2-HMAC-SHA256(password UTF-8, salt, 100_000) → 32 字节 AES key
/// salt 非法 base64（如 auth.json 损坏）返回 Err，不 panic
pub fn derive_key(password: &str, salt_b64: &str) -> Result<[u8; 32], ServerError> {
    let salt = B64
        .decode(salt_b64)
        .map_err(|e| ServerError::Crypto(format!("invalid salt base64: {e}")))?;
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), &salt, PBKDF2_ITERATIONS, &mut key);
    Ok(key)
}

/// TS: exportKeyToBase64
pub fn key_to_base64(key: &[u8; 32]) -> String {
    B64.encode(key)
}

/// TS: importKeyFromBase64（必须恰好 32 字节）
pub fn key_from_base64(key_b64: &str) -> Result<[u8; 32], ServerError> {
    let bytes = B64
        .decode(key_b64)
        .map_err(|e| ServerError::Crypto(e.to_string()))?;
    <[u8; 32]>::try_from(bytes.as_slice())
        .map_err(|_| ServerError::Crypto("encryption key must be 32 bytes".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_salt_is_16_bytes_base64() {
        let salt = generate_salt();
        assert_eq!(salt.len(), 24); // base64(16B) = 24 字符
        assert_eq!(B64.decode(&salt).unwrap().len(), SALT_LEN);
        assert_ne!(generate_salt(), generate_salt()); // 随机
    }

    #[test]
    fn key_base64_round_trip() {
        let key = derive_key("pw", "AAECAwQFBgcICQoLDA0ODw==").unwrap();
        let b64 = key_to_base64(&key);
        assert_eq!(b64.len(), 44);
        assert_eq!(key_from_base64(&b64).unwrap(), key);
    }

    #[test]
    fn derive_key_rejects_invalid_salt_base64() {
        // auth.json 损坏（salt 非 base64）→ Err 而非 panic
        assert!(matches!(
            derive_key("pw", "not-base64!!!"),
            Err(ServerError::Crypto(_))
        ));
        assert!(derive_key("pw", "").is_ok()); // 空 salt 合法 base64，可派生
    }

    #[test]
    fn key_from_base64_rejects_wrong_length() {
        assert!(key_from_base64(&B64.encode([0u8; 16])).is_err());
        assert!(key_from_base64("not-base64!!!").is_err());
    }
}
