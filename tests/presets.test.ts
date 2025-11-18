import { test, expect, describe } from "bun:test";
import {
  allPresets,
  getPresetById,
  getInternationalPresets,
  getChinesePresets,
  anthropicPreset,
  minimaxPreset,
  zhipuPreset,
  moonshotPreset,
} from "../src/providers/presets.js";

describe("供应商预设", () => {
  test("应该包含所有必要的供应商", () => {
    const presetIds = allPresets.map(p => p.id);

    expect(presetIds).toContain("anthropic");
    expect(presetIds).toContain("openrouter");
    expect(presetIds).toContain("minimax");
    expect(presetIds).toContain("zhipu");
    expect(presetIds).toContain("moonshot");
    expect(presetIds).toContain("deepseek");
    expect(presetIds).toContain("alibaba");
    expect(presetIds).toContain("custom");
  });

  test("应该能够通过ID获取预设", () => {
    const preset = getPresetById("anthropic");
    expect(preset).toBeDefined();
    expect(preset?.id).toBe("anthropic");
    expect(preset?.name).toBe("Anthropic");
  });

  test("应该能够获取所有国际服务商", () => {
    const international = getInternationalPresets();
    expect(international.length).toBeGreaterThan(0);

    international.forEach(preset => {
      expect(preset.isChinese).toBeUndefined();
    });
  });

  test("应该能够获取所有国内服务商", () => {
    const chinese = getChinesePresets();
    expect(chinese.length).toBeGreaterThan(0);

    chinese.forEach(preset => {
      expect(preset.isChinese).toBe(true);
    });
  });

  test("Anthropic预设应该包含正确的配置", () => {
    expect(anthropicPreset.id).toBe("anthropic");
    expect(anthropicPreset.baseURL).toBe("https://api.anthropic.com");
    expect(anthropicPreset.authType).toBe("api-key");
    expect(anthropicPreset.defaultModels.length).toBeGreaterThan(0);
    expect(anthropicPreset.defaultModels).toContain("claude-3-5-sonnet-20241022");
  });

  test("MiniMax预设应该包含正确的配置", () => {
    expect(minimaxPreset.id).toBe("minimax");
    expect(minimaxPreset.isChinese).toBe(true);
    expect(minimaxPreset.baseURL).toBe("https://api.minimax.chat/v1");
    expect(minimaxPreset.authType).toBe("bearer");
    expect(minimaxPreset.defaultModels).toContain("abab6.5s-chat");
  });

  test("智谱AI预设应该包含正确的配置", () => {
    expect(zhipuPreset.id).toBe("zhipu");
    expect(zhipuPreset.isChinese).toBe(true);
    expect(zhipuPreset.baseURL).toBe("https://open.bigmodel.cn/api/paas/v4");
    expect(zhipuPreset.defaultModels).toContain("glm-4");
  });

  test("Moonshot预设应该包含正确的配置", () => {
    expect(moonshotPreset.id).toBe("moonshot");
    expect(moonshotPreset.isChinese).toBe(true);
    expect(moonshotPreset.baseURL).toBe("https://api.moonshot.cn/v1");
    expect(moonshotPreset.defaultModels).toContain("moonshot-v1-8k");
  });

  test("自定义预设应该为空配置", () => {
    const custom = getPresetById("custom");
    expect(custom?.id).toBe("custom");
    expect(custom?.baseURL).toBe("");
    expect(custom?.defaultModels.length).toBe(0);
  });

  test("所有预设都应该有必要的属性", () => {
    allPresets.forEach(preset => {
      expect(preset.id).toBeDefined();
      expect(preset.name).toBeDefined();
      expect(preset.displayName).toBeDefined();
      expect(preset.baseURL).toBeDefined();
      expect(preset.defaultModels).toBeDefined();
      expect(preset.authType).toBeDefined();
    });
  });

  test("应该正确区分国际和国内服务", () => {
    const international = getInternationalPresets();
    const chinese = getChinesePresets();
    const allProviderIds = [...international, ...chinese].map(p => p.id);

    // 验证没有重叠
    const overlap = international.filter(i =>
      chinese.some(c => c.id === i.id)
    );
    expect(overlap.length).toBe(0);

    // 验证所有供应商都被分类
    expect(allProviderIds.length).toBe(allPresets.length - 1); // 减去custom
  });
});
