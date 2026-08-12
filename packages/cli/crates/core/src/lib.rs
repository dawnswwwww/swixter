pub mod adapters;
pub mod coder;
pub mod config;
pub mod export;
pub mod groups;
pub mod model;
pub mod paths;
pub mod presets;
pub mod types;
pub mod user_providers;
pub mod validate;

#[derive(thiserror::Error, Debug)]
pub enum CoreError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("toml error: {0}")]
    Toml(#[from] toml_edit::de::Error),
    #[error("yaml error: {0}")]
    Yaml(#[from] serde_yaml_ng::Error),
    #[error("validation error: {0}")]
    Validation(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("in use: {0}")]
    InUse(String),
    #[error("unknown provider: {0}")]
    UnknownProvider(String),
    #[error("invalid import: {0}")]
    InvalidImport(String),
}
