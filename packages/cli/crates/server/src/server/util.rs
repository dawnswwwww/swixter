use swixter_core::types::Profile;

/// TS: server/api/util.ts maskApiKey
pub fn mask_api_key(api_key: &str) -> String {
    mask_secret(api_key)
}

pub fn mask_auth_token(token: Option<&str>) -> Option<String> {
    token.map(mask_secret)
}

fn mask_secret(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= 8 {
        return "****".into();
    }
    let first: String = chars[..4].iter().collect();
    let last: String = chars[chars.len() - 4..].iter().collect();
    let stars = "*".repeat((chars.len() - 8).min(20));
    format!("{first}{stars}{last}")
}

/// TS: sanitizeProfile —— GET 响应默认掩码（apiKey/authToken 替换为掩码值）
pub fn sanitize_profile(profile: &Profile) -> Profile {
    let mut p = profile.clone();
    p.api_key = mask_api_key(&p.api_key);
    if let Some(t) = &p.auth_token {
        p.auth_token = Some(mask_secret(t));
    }
    p
}

/// TS: generateETag —— "\"<mtime秒>-<size>\""
pub fn generate_etag(mtime_secs: u64, size: u64) -> String {
    format!("\"{mtime_secs}-{size}\"")
}

/// TS: parseIfNoneMatch —— 去引号
pub fn parse_if_none_match(header: &str) -> &str {
    header.trim_matches('"')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mask_rules_match_ts() {
        assert_eq!(mask_api_key(""), "****");
        assert_eq!(mask_api_key("short123"), "****"); // ≤8
                                                      // 15 字符 → min(15-8, 20) = 7 星号（计划示例 "sk-a****1234" 为笔误，以对齐 TS 的实现为准）
        assert_eq!(mask_api_key("sk-abcdefgh1234"), "sk-a*******1234");
        // 星号数量 min(len-8, 20)
        assert_eq!(
            mask_api_key(&"x".repeat(40)),
            format!("xxxx{}xxxx", "*".repeat(20))
        );
        assert_eq!(mask_auth_token(None), None);
        assert_eq!(mask_auth_token(Some("t")), Some("****".into()));
    }

    #[test]
    fn etag_format_and_parse() {
        let etag = generate_etag(1_700_000_000, 1234);
        assert_eq!(etag, "\"1700000000-1234\"");
        assert_eq!(parse_if_none_match(&etag), "1700000000-1234");
        assert_eq!(parse_if_none_match("1700000000-1234"), "1700000000-1234");
    }
}
