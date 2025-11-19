import { test, expect, describe } from "bun:test";
import {
  allPresets,
  getPresetById,
  getStandardPresets,
  anthropicPreset,
  ollamaPreset,
  customPreset,
} from "../src/providers/presets.js";

describe("Provider Presets", () => {
  test("should contain all required providers", () => {
    const presetIds = allPresets.map(p => p.id);

    expect(presetIds).toContain("anthropic");
    expect(presetIds).toContain("ollama");
    expect(presetIds).toContain("custom");
    expect(presetIds.length).toBe(3);
  });

  test("should be able to get preset by ID", () => {
    const preset = getPresetById("anthropic");
    expect(preset).toBeDefined();
    expect(preset?.id).toBe("anthropic");
    expect(preset?.name).toBe("Anthropic");
  });

  test("should be able to get standard presets (excluding custom)", async () => {
    const standard = await getStandardPresets();
    expect(standard.length).toBe(2);

    const ids = standard.map(p => p.id);
    expect(ids).toContain("anthropic");
    expect(ids).toContain("ollama");
    expect(ids).not.toContain("custom");
  });

  test("Anthropic preset should contain correct configuration", () => {
    expect(anthropicPreset.id).toBe("anthropic");
    expect(anthropicPreset.baseURL).toBe("https://api.anthropic.com");
    expect(anthropicPreset.authType).toBe("api-key");
    expect(anthropicPreset.defaultModels.length).toBeGreaterThan(0);
    expect(anthropicPreset.defaultModels).toContain("claude-3-5-sonnet-20241022");
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
});
