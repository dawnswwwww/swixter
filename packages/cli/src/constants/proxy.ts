export const DEFAULT_PROXY_HOST = "127.0.0.1";
export const DEFAULT_PROXY_PORT = 15721;
export const SWIXTER_PROXY_AUTH_TOKEN = "swixter-local-proxy";
/**
 * Name of the env var that holds the proxy auth token in the CODER's
 * environment (Codex reads this via the provider table's env_key).
 *
 * The VALUE inside that var is SWIXTER_PROXY_AUTH_TOKEN; this constant is only
 * the NAME. Codex provider tables that bridge through the local proxy set
 * `env_key = SWIXTER_PROXY_ENV_KEY` so Codex sends `swixter-local-proxy` as
 * its bearer, which the proxy authenticates before forwarding with the
 * profile's real credential.
 */
export const SWIXTER_PROXY_ENV_KEY = "SWIXTER_PROXY_KEY";
export const SWIXTER_CLAUDE_MODEL = "SWIXTER_CLAUDE_MODEL";
export const SWIXTER_CLAUDE_HAIKU_MODEL = "SWIXTER_CLAUDE_HAIKU_MODEL";
export const SWIXTER_CLAUDE_SONNET_MODEL = "SWIXTER_CLAUDE_SONNET_MODEL";
export const SWIXTER_CLAUDE_OPUS_MODEL = "SWIXTER_CLAUDE_OPUS_MODEL";
