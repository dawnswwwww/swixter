use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};

use crate::ServerError;

/// TS: crypto/encrypt.ts encrypt —— base64( IV[12] || ciphertext || tag[16] )
pub fn encrypt(key: &[u8; 32], plaintext: &str) -> Result<String, ServerError> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng); // 96-bit
    let ct = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| ServerError::Crypto(e.to_string()))?;
    let mut combined = nonce.to_vec();
    combined.extend_from_slice(&ct);
    Ok(B64.encode(combined))
}

/// TS: decrypt —— 前 12 字节 IV，其余 ct+tag
pub fn decrypt(key: &[u8; 32], ciphertext_b64: &str) -> Result<String, ServerError> {
    let combined = B64
        .decode(ciphertext_b64)
        .map_err(|e| ServerError::Crypto(e.to_string()))?;
    if combined.len() < crate::NONCE_LEN + crate::TAG_LEN {
        return Err(ServerError::Crypto("ciphertext too short".into()));
    }
    let (iv, ct) = combined.split_at(crate::NONCE_LEN);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let pt = cipher
        .decrypt(Nonce::from_slice(iv), ct)
        .map_err(|e| ServerError::Crypto(e.to_string()))?;
    String::from_utf8(pt).map_err(|e| ServerError::Crypto(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::derive::derive_key;

    #[test]
    fn encrypt_decrypt_round_trip() {
        let key = derive_key("pw", "AAECAwQFBgcICQoLDA0ODw==").unwrap();
        for pt in ["", "hello", "中文-🔐"] {
            let ct = encrypt(&key, pt).unwrap();
            assert_eq!(decrypt(&key, &ct).unwrap(), pt);
        }
    }

    #[test]
    fn ciphertext_layout_is_iv_ct_tag() {
        let key = derive_key("pw", "AAECAwQFBgcICQoLDA0ODw==").unwrap();
        let pt = "hello";
        let ct = encrypt(&key, pt).unwrap();
        let raw = B64.decode(&ct).unwrap();
        // 12 字节 IV + 5 字节明文 + 16 字节 tag
        assert_eq!(raw.len(), crate::NONCE_LEN + pt.len() + crate::TAG_LEN);
    }

    #[test]
    fn decrypt_rejects_short_or_wrong_key() {
        let key = derive_key("pw", "AAECAwQFBgcICQoLDA0ODw==").unwrap();
        let ct = encrypt(&key, "hello").unwrap();
        let other = derive_key("other", "AAECAwQFBgcICQoLDA0ODw==").unwrap();
        assert!(decrypt(&other, &ct).is_err());
        assert!(decrypt(&key, &B64.encode([0u8; 10])).is_err());
        assert!(decrypt(&key, "not-base64!!!").is_err());
    }
}
