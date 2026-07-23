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
}

pub const CODERS: &[CoderSpec] = &[
    CoderSpec {
        id: "claude",
        display_name: "Claude Code",
        executable: "claude",
        adapter: AdapterKind::Claude,
        supports_auth_token: true,
    },
    CoderSpec {
        id: "codex",
        display_name: "Codex",
        executable: "codex",
        adapter: AdapterKind::Codex,
        supports_auth_token: false,
    },
    // qwen 历史命名，实际目标是 Continue.dev（TS: getAdapter("qwen") → ContinueAdapter）
    CoderSpec {
        id: "qwen",
        display_name: "Qwen (Continue.dev)",
        executable: "qwen",
        adapter: AdapterKind::Continue,
        supports_auth_token: false,
    },
];

pub fn get_coder(id: &str) -> Option<&'static CoderSpec> {
    CODERS.iter().find(|c| c.id == id)
}
