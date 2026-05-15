import { test, expect, describe } from "bun:test";
import {
  allPresets,
  getPresetById,
  getPresetByIdAsync,
  getStandardPresets,
  getProvidersByWireApi,
  anthropicPreset,
  ollamaPreset,
  customPreset,
  groqPreset,
  deepseekPreset,
  moonshotPreset,
  togetherPreset,
  fireworksPreset,
  zeroonePreset,
  minimaxCnPreset,
  minimaxGlobalPreset,
  zhipuCnPreset,
  zhipuGlobalPreset,
  dashscopePreset,
} from "../src/providers/presets.js";

describe("Provider Presets", () => {
  test("should contain all required providers", () => {
    const presetIds = allPresets.map(p => p.id);

    expect(presetIds).toContain("anthropic");
    expect(presetIds).toContain("ollama");
    expect(presetIds).toContain("custom");
    // 28 new cc-switch migrated providers added: stepfun, modelscope, longcat, bailing,
    // siliconflow-cn, siliconflow-global, dmxapi, packycode, cubence, aigocode, rightcode,
    // aicodemirror, aicoding, crazyrouter, sssai-code, compshare, micu, xcode, ctok,
    // openrouter, novita, github-copilot, nvidia, xiaomi-mimo, bailian-for-coding,
    // kimi-for-coding, doubao-seed, aihubmix
    expect(presetIds.length).toBe(42);
  });

  test("should be able to get preset by ID", () => {
    const preset = getPresetById("anthropic");
    expect(preset).toBeDefined();
    expect(preset?.id).toBe("anthropic");
    expect(preset?.name).toBe("Anthropic");
  });

  test("should be able to get standard presets (excluding custom)", async () => {
    const standard = await getStandardPresets();
    // 41 standard presets (excluding custom which is not counted as standard)
    expect(standard.length).toBe(41);

    const ids = standard.map(p => p.id);
    expect(ids).toContain("anthropic");
    expect(ids).toContain("ollama");
    expect(ids).not.toContain("custom");
  });

  test("Anthropic preset should contain correct configuration", () => {
    expect(anthropicPreset.id).toBe("anthropic");
    expect(anthropicPreset.baseURL).toBe("https://api.anthropic.com");
    expect(anthropicPreset.authType).toBe("api-key");
    // Using modelFamilies instead of defaultModels
    expect(anthropicPreset.defaultModels).toEqual([]);
    expect(anthropicPreset.modelFamilies).toBeDefined();
    const sonnetFamily = anthropicPreset.modelFamilies!.find(f => f.id === "sonnet");
    expect(sonnetFamily).toBeDefined();
    expect(sonnetFamily!.models).toContain("claude-3-5-sonnet-20241022");
  });

  test("Ollama preset should contain correct configuration", () => {
    expect(ollamaPreset.id).toBe("ollama");
    expect(ollamaPreset.baseURL).toBe("http://localhost:11434");
    expect(ollamaPreset.authType).toBe("custom");
    expect(ollamaPreset.defaultModels).toContain("qwen2.5-coder:7b");
  });

  test("Custom preset should have empty configuration", () => {
    expect(customPreset.id).toBe("custom");
    expect(customPreset.baseURL).toBe("");
    expect(customPreset.defaultModels.length).toBe(0);
  });

  test("All presets should have required properties", () => {
    allPresets.forEach(preset => {
      expect(preset.id).toBeDefined();
      expect(preset.name).toBeDefined();
      expect(preset.displayName).toBeDefined();
      expect(preset.baseURL).toBeDefined();
      expect(preset.defaultModels).toBeDefined();
      expect(preset.authType).toBeDefined();
    });
  });

  test("should return undefined for non-existent preset", () => {
    const preset = getPresetById("non-existent");
    expect(preset).toBeUndefined();
  });

  // Overseas Provider Tests

  test("Groq preset should contain correct configuration", () => {
    expect(groqPreset.id).toBe("groq");
    expect(groqPreset.baseURL).toBe("https://api.groq.com/openai/v1");
    expect(groqPreset.authType).toBe("api-key");
    expect(groqPreset.wire_api).toBe("chat");
    expect(groqPreset.env_key).toBe("GROQ_API_KEY");
    expect(groqPreset.defaultModels).toContain("llama-3.3-70b-versatile");
  });

  test("DeepSeek preset should contain correct configuration", () => {
    expect(deepseekPreset.id).toBe("deepseek");
    expect(deepseekPreset.baseURL).toBe("https://api.deepseek.com/anthropic");
    expect(deepseekPreset.baseURLChat).toBe("https://api.deepseek.com");
    expect(deepseekPreset.authType).toBe("api-key");
    expect(deepseekPreset.wire_api).toBe("chat");
    expect(deepseekPreset.env_key).toBe("DEEPSEEK_API_KEY");
    expect(deepseekPreset.defaultModels).toContain("deepseek-chat");
  });

  test("Moonshot preset should contain correct configuration", () => {
    expect(moonshotPreset.id).toBe("moonshot");
    expect(moonshotPreset.baseURL).toBe("https://api.moonshot.cn/v1");
    expect(moonshotPreset.authType).toBe("api-key");
    expect(moonshotPreset.wire_api).toBe("chat");
    expect(moonshotPreset.env_key).toBe("MOONSHOT_API_KEY");
    expect(moonshotPreset.defaultModels).toContain("moonshot-v1-128k");
  });

  test("Together AI preset should contain correct configuration", () => {
    expect(togetherPreset.id).toBe("together");
    expect(togetherPreset.baseURL).toBe("https://api.together.xyz");
    expect(togetherPreset.authType).toBe("api-key");
    expect(togetherPreset.wire_api).toBe("chat");
    expect(togetherPreset.env_key).toBe("TOGETHER_API_KEY");
  });

  test("Fireworks AI preset should contain correct configuration", () => {
    expect(fireworksPreset.id).toBe("fireworks");
    expect(fireworksPreset.baseURL).toBe("https://api.fireworks.ai/v1");
    expect(fireworksPreset.authType).toBe("api-key");
    expect(fireworksPreset.wire_api).toBe("chat");
    expect(fireworksPreset.env_key).toBe("FIREWORKS_API_KEY");
    expect(fireworksPreset.defaultModels).toContain("qwen2.5-72b-instruct");
  });

  test("01.ai preset should contain correct configuration", () => {
    expect(zeroonePreset.id).toBe("zeroone");
    expect(zeroonePreset.baseURL).toBe("https://api.01.ai/v1");
    expect(zeroonePreset.authType).toBe("api-key");
    expect(zeroonePreset.wire_api).toBe("chat");
    expect(zeroonePreset.env_key).toBe("ZEROONE_API_KEY");
    expect(zeroonePreset.defaultModels).toContain("yi-large");
  });

  // China Provider Tests

  test("MiniMax CN preset should contain correct configuration", () => {
    expect(minimaxCnPreset.id).toBe("minimax-cn");
    expect(minimaxCnPreset.baseURL).toBe("https://api.minimaxi.com/anthropic");
    expect(minimaxCnPreset.authType).toBe("api-key");
    expect(minimaxCnPreset.wire_api).toBe("responses");
    expect(minimaxCnPreset.env_key).toBe("ANTHROPIC_API_KEY");
    expect(minimaxCnPreset.isChinese).toBe(true);
  });

  test("MiniMax Global preset should contain correct configuration", () => {
    expect(minimaxGlobalPreset.id).toBe("minimax-global");
    expect(minimaxGlobalPreset.baseURL).toBe("https://api.minimax.io/anthropic");
    expect(minimaxGlobalPreset.wire_api).toBe("responses");
    expect(minimaxGlobalPreset.env_key).toBe("ANTHROPIC_API_KEY");
    expect(minimaxGlobalPreset.isChinese).toBeUndefined();
  });

  test("Zhipu AI CN preset should contain correct configuration", () => {
    expect(zhipuCnPreset.id).toBe("zhipu-cn");
    expect(zhipuCnPreset.baseURL).toBe("https://open.bigmodel.cn/api/anthropic");
    expect(zhipuCnPreset.authType).toBe("api-key");
    expect(zhipuCnPreset.wire_api).toBe("responses");
    expect(zhipuCnPreset.env_key).toBe("ANTHROPIC_API_KEY");
    expect(zhipuCnPreset.isChinese).toBe(true);
  });

  test("Zhipu AI Global preset should contain correct configuration", () => {
    expect(zhipuGlobalPreset.id).toBe("zhipu-global");
    expect(zhipuGlobalPreset.baseURL).toBe("https://api.z.ai/api/anthropic");
    expect(zhipuGlobalPreset.wire_api).toBe("responses");
    expect(zhipuGlobalPreset.env_key).toBe("ANTHROPIC_AUTH_TOKEN");
  });

  test("Dashscope preset should contain correct configuration", () => {
    expect(dashscopePreset.id).toBe("dashscope");
    expect(dashscopePreset.baseURL).toBe("https://coding.dashscope.aliyuncs.com/v1");
    expect(dashscopePreset.authType).toBe("api-key");
    expect(dashscopePreset.wire_api).toBe("chat");
    expect(dashscopePreset.env_key).toBe("DASHSCOPE_API_KEY");
    expect(dashscopePreset.isChinese).toBe(true);
  });

  // Function tests

  test("should be able to get new presets by ID synchronously", () => {
    const groq = getPresetById("groq");
    expect(groq).toBeDefined();
    expect(groq?.id).toBe("groq");
    expect(groq?.env_key).toBe("GROQ_API_KEY");

    const deepseek = getPresetById("deepseek");
    expect(deepseek).toBeDefined();
    expect(deepseek?.id).toBe("deepseek");

    const dashscope = getPresetById("dashscope");
    expect(dashscope).toBeDefined();
    expect(dashscope?.id).toBe("dashscope");
  });

  test("should be able to get new presets by ID asynchronously", async () => {
    const groq = await getPresetByIdAsync("groq");
    expect(groq).toBeDefined();
    expect(groq?.id).toBe("groq");

    const moonshot = await getPresetByIdAsync("moonshot");
    expect(moonshot).toBeDefined();
    expect(moonshot?.id).toBe("moonshot");

    const minimaxCn = await getPresetByIdAsync("minimax-cn");
    expect(minimaxCn).toBeDefined();
    expect(minimaxCn?.id).toBe("minimax-cn");
  });

  test("should filter providers by wire_api type", async () => {
    const chatProviders = await getProvidersByWireApi("chat");
    const chatIds = chatProviders.map(p => p.id);

    // Should include chat providers
    expect(chatIds).toContain("groq");
    expect(chatIds).toContain("deepseek");
    expect(chatIds).toContain("moonshot");
    expect(chatIds).toContain("together");
    expect(chatIds).toContain("fireworks");
    expect(chatIds).toContain("zeroone");
    expect(chatIds).toContain("dashscope");

    // Should NOT include responses providers
    expect(chatIds).not.toContain("minimax-cn");
    expect(chatIds).not.toContain("minimax-global");
    expect(chatIds).not.toContain("zhipu-global");

    const responsesProviders = await getProvidersByWireApi("responses");
    const responsesIds = responsesProviders.map(p => p.id);

    // Should include responses providers
    expect(responsesIds).toContain("anthropic");
    expect(responsesIds).toContain("minimax-cn");
    expect(responsesIds).toContain("minimax-global");
    expect(responsesIds).toContain("zhipu-cn");
    expect(responsesIds).toContain("zhipu-global");

    // Should NOT include chat-only providers
    expect(responsesIds).not.toContain("groq");
    expect(responsesIds).not.toContain("deepseek");
  });

  test("all non-custom presets should have defaultApiFormat", () => {
    const withoutApiFormat = allPresets.filter(p => p.id !== "custom" && !p.defaultApiFormat);
    expect(withoutApiFormat).toEqual([]);
  });

  test("defaultApiFormat should be set for all chat providers (except custom and dual-format)", () => {
    // DeepSeek and OpenRouter have wire_api=chat but defaultApiFormat=anthropic_messages
    // because their default baseURL uses Anthropic format. This is correct — they serve
    // Anthropic format by default but also have baseURLChat for OpenAI Chat.
    const dualFormatPresets = ["deepseek", "openrouter"];
    const chatPresets = allPresets.filter(p => p.wire_api === "chat" && p.id !== "custom" && !dualFormatPresets.includes(p.id));
    chatPresets.forEach(preset => {
      expect(preset.defaultApiFormat).toBe("openai_chat");
    });

    // Dual-format presets should have anthropic_messages as default (their primary baseURL)
    dualFormatPresets.forEach(id => {
      const preset = getPresetById(id);
      expect(preset?.defaultApiFormat).toBe("anthropic_messages");
      expect(preset?.baseURLChat).toBeDefined();
    });
  });

  test("custom preset should NOT have defaultApiFormat", () => {
    expect(customPreset.defaultApiFormat).toBeUndefined();
  });
});
