#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdapterKind {
    Claude,
    Codex,
    Continue,
}

pub struct CoderSpec {
    pub id: &'static str,
    pub display_name: &'static str,
    pub executable: &'static str,
    pub adapter: AdapterKind,
    pub supports_auth_token: bool,
    /// TS constants/coders.ts wireApi（"chat" | "responses" | "both"），
    /// Web UI apply 的 wire_api 兼容性检查与列表响应使用
    pub wire_api: &'static str,
}

pub const CODERS: &[CoderSpec] = &[
    CoderSpec {
        id: "claude",
        display_name: "Claude Code",
        executable: "claude",
        adapter: AdapterKind::Claude,
        supports_auth_token: true,
        wire_api: "both",
    },
    CoderSpec {
        id: "codex",
        display_name: "Codex",
        executable: "codex",
        adapter: AdapterKind::Codex,
        supports_auth_token: false,
        wire_api: "chat",
    },
    // qwen 历史命名，实际目标是 Continue.dev（TS: getAdapter("qwen") → ContinueAdapter）
    CoderSpec {
        id: "qwen",
        display_name: "Qwen (Continue.dev)",
        executable: "qwen",
        adapter: AdapterKind::Continue,
        supports_auth_token: false,
        wire_api: "chat",
    },
];

pub fn get_coder(id: &str) -> Option<&'static CoderSpec> {
    CODERS.iter().find(|c| c.id == id)
}
