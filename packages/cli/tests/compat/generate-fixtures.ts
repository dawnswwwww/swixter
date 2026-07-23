// 用法: bun run tests/compat/generate-fixtures.ts
import { saveConfig } from "../../src/config/manager.js";
import { mkdtempSync, copyFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = new URL("./fixtures/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

async function dump(name: string, config: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "swixter-fx-"));
  const cfgPath = join(dir, "config.json");
  process.env.SWIXTER_CONFIG_PATH = cfgPath;
  // saveConfig 会做 zod 校验 + 2 空格缩进序列化，与线上一致
  await saveConfig(config as any);
  copyFileSync(cfgPath, join(out, name));
  console.log("wrote", name);
}

const full = {
  version: "2.0.0",
  profiles: {
    "work-kimi": {
      name: "work-kimi", providerId: "kimi-coding", apiKey: "sk-test-1234567890",
      authToken: "tok-abc", baseURL: "https://api.kimi.com/coding/",
      models: { anthropicModel: "kimi-for-coding", defaultHaikuModel: "h1", defaultOpusModel: "o1", defaultSonnetModel: "s1" },
      headers: { "X-Custom": "v" }, apiFormat: "anthropic_messages",
      createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-02T00:00:00.000Z",
    },
    "local-ollama": {
      name: "local-ollama", providerId: "ollama", apiKey: "",
      baseURL: "http://localhost:11434", model: "qwen2.5-coder:7b",
      openaiModel: "qwen2.5-coder:7b", envKey: "OLLAMA_API_KEY",
      createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z",
    },
  },
  coders: { claude: { activeProfile: "work-kimi" }, codex: { activeProfile: "" } },
  groups: {
    "grp_1735689600000_abc123": {
      id: "grp_1735689600000_abc123", name: "failover",
      profiles: ["work-kimi", "local-ollama"], isDefault: true,
      createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z",
    },
  },
  activeGroup: "grp_1735689600000_abc123",
  syncMeta: { lastSyncAt: "2025-01-03T00:00:00.000Z", configVersion: 3, providersVersion: 1, localUpdatedAt: "2025-01-03T00:00:00.000Z", dirty: true },
};

await dump("full.json", full);
await dump("empty-default.json", { version: "2.0.0", profiles: {}, coders: {}, groups: {} });
// v1 旧格式：顶层 activeProfile，无 coders/groups（不走 saveConfig，直接写原文）
{
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(out, "v1-legacy.json"), JSON.stringify({
    version: "1.0.0", activeProfile: "work-kimi", profiles: full.profiles,
  }, null, 2) + "\n");
  writeFileSync(join(out, "unknown-fields.json"), JSON.stringify({
    ...full, futureField: { x: 1 },
    profiles: { "work-kimi": { ...full.profiles["work-kimi"], futureProfileField: true } },
  }, null, 2) + "\n");
  writeFileSync(join(out, "invalid-url.json"), JSON.stringify({
    version: "2.0.0", coders: {}, groups: {},
    profiles: { bad: { name: "bad", providerId: "custom", apiKey: "k", baseURL: "not a url", createdAt: "t", updatedAt: "t" } },
  }, null, 2) + "\n");
}
console.log("done");
