use serde_json::Value;

use crate::crypto::encrypt::{decrypt, encrypt};
use crate::ServerError;

/// TS: crypto/fields.ts SENSITIVE_FIELDS
pub const SENSITIVE_FIELDS: [&str; 2] = ["apiKey", "authToken"];

/// TS: encryptSensitiveFields —— 浅拷贝，仅 string 值加密
pub fn encrypt_sensitive_fields(key: &[u8; 32], obj: &Value) -> Result<Value, ServerError> {
    let mut result = obj.clone();
    if let Some(map) = result.as_object_mut() {
        for field in SENSITIVE_FIELDS {
            if let Some(Value::String(s)) = map.get(field) {
                let ct = encrypt(key, s)?;
                map.insert(field.to_string(), Value::String(ct));
            }
        }
    }
    Ok(result)
}

/// TS: decryptSensitiveFields
pub fn decrypt_sensitive_fields(key: &[u8; 32], obj: &Value) -> Result<Value, ServerError> {
    let mut result = obj.clone();
    if let Some(map) = result.as_object_mut() {
        for field in SENSITIVE_FIELDS {
            if let Some(Value::String(s)) = map.get(field) {
                let pt = decrypt(key, s)?;
                map.insert(field.to_string(), Value::String(pt));
            }
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::derive::derive_key;
    use serde_json::json;

    #[test]
    fn only_api_key_and_auth_token_strings_are_encrypted() {
        let key = derive_key("pw", "AAECAwQFBgcICQoLDA0ODw==").unwrap();
        let obj = json!({
            "apiKey": "sk-123",
            "authToken": "tok-456",
            "baseURL": "https://api.example.com",
            "nested": {"apiKey": "sk-inner"},
            "apiKeyNum": 42
        });
        let enc = encrypt_sensitive_fields(&key, &obj).unwrap();
        assert_ne!(enc["apiKey"], "sk-123");
        assert_ne!(enc["authToken"], "tok-456");
        // 其余字段原样（含嵌套对象里的 apiKey —— 浅拷贝只处理顶层）
        assert_eq!(enc["baseURL"], "https://api.example.com");
        assert_eq!(enc["nested"], json!({"apiKey": "sk-inner"}));
        assert_eq!(enc["apiKeyNum"], 42);
        // 原始对象不被修改
        assert_eq!(obj["apiKey"], "sk-123");
        // 解密还原
        let dec = decrypt_sensitive_fields(&key, &enc).unwrap();
        assert_eq!(dec, obj);
    }

    #[test]
    fn missing_sensitive_fields_is_noop() {
        let key = derive_key("pw", "AAECAwQFBgcICQoLDA0ODw==").unwrap();
        let obj = json!({"baseURL": "https://x"});
        assert_eq!(encrypt_sensitive_fields(&key, &obj).unwrap(), obj);
    }
}
