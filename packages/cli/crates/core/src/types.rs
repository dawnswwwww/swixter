use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const CONFIG_VERSION: &str = "2.0.0";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ConfigFile {
    pub profiles: HashMap<String, Profile>,
    pub coders: HashMap<String, CoderConfig>,
    pub groups: HashMap<String, Group>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_group: Option<String>,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_meta: Option<SyncMeta>,
}

impl ConfigFile {
    pub fn empty() -> Self {
        Self {
            version: CONFIG_VERSION.to_string(),
            ..Default::default()
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Profile {
    pub name: String,
    pub provider_id: String,
    pub api_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_token: Option<String>,
    // TS 字段名是 baseURL（大写 URL），camelCase 默认会生成 baseUrl，必须显式 rename
    #[serde(rename = "baseURL", skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub openai_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models: Option<ModelsConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_format: Option<ApiFormat>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ModelsConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anthropic_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_haiku_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_opus_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_sonnet_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CoderConfig {
    pub active_profile: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Group {
    pub id: String,
    pub name: String,
    pub profiles: Vec<String>,
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SyncMeta {
    pub last_sync_at: String,
    pub config_version: u64,
    pub providers_version: u64,
    pub local_updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dirty: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ApiFormat {
    #[serde(rename = "anthropic_messages")]
    AnthropicMessages,
    #[serde(rename = "anthropic_responses")]
    AnthropicResponses,
    #[serde(rename = "openai_chat")]
    OpenaiChat,
    #[serde(rename = "openai_responses")]
    OpenaiResponses,
    #[serde(rename = "gemini_native")]
    GeminiNative,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum AuthType {
    #[serde(rename = "bearer")]
    Bearer,
    #[default]
    #[serde(rename = "api-key")]
    ApiKey,
    #[serde(rename = "custom")]
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WireApi {
    #[serde(rename = "chat")]
    Chat,
    #[serde(rename = "responses")]
    Responses,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ProviderPreset {
    pub id: String,
    pub name: String,
    pub display_name: String,
    // 同 Profile：TS 字段名是 baseURL
    #[serde(rename = "baseURL")]
    pub base_url: String,
    #[serde(rename = "baseURLChat", skip_serializing_if = "Option::is_none")]
    pub base_url_chat: Option<String>,
    pub default_models: Vec<String>,
    pub auth_type: AuthType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate_limit: Option<RateLimit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docs: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_chinese: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_api_format: Option<ApiFormat>,
    // 注意：wire_api / env_key 在 TS 中就是下划线命名，必须显式 rename，
    // 否则 rename_all = "camelCase" 会把它们序列化为 wireApi / envKey
    #[serde(rename = "wire_api", skip_serializing_if = "Option::is_none")]
    pub wire_api: Option<WireApi>,
    #[serde(rename = "env_key", skip_serializing_if = "Option::is_none")]
    pub env_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_families: Option<Vec<ModelFamily>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RateLimit {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requests_per_minute: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_per_minute: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelFamily {
    pub id: String,
    pub name: String,
    pub models: Vec<String>,
}
