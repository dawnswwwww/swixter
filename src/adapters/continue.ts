import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import * as yaml from "js-yaml";
import type { CoderAdapter } from "./base.js";
import type { ClaudeCodeProfile } from "../types.js";
import { getPresetById } from "../providers/presets.js";
import { getConfigPath } from "../constants/paths.js";
import { SERIALIZATION } from "../constants/index.js";

/**
 * Provider ID to Continue provider type mapping
 */
const PROVIDER_MAP: Record<string, string> = {
  anthropic: "anthropic",
  openai: "openai",
  openrouter: "openai", // OpenRouter uses openai compatible interface
  ollama: "ollama",
  custom: "openai",
};

/**
 * Continue/Qwen configuration adapter
 * Maps Swixter profile to ~/.continue/config.yaml
 */
export class ContinueAdapter implements CoderAdapter {
  name = "continue";
  configPath = getConfigPath("continue");

  /**
   * Apply configuration to Continue
   * Generate YAML format configuration
   */
  async apply(profile: ClaudeCodeProfile): Promise<void> {
    const preset = getPresetById(profile.providerId);
    const baseURL = profile.baseURL || preset?.baseURL || "";
    const continueProvider = PROVIDER_MAP[profile.providerId] || "openai";

    // Read existing configuration (if exists)
    let existingConfig: any = {};
    if (existsSync(this.configPath)) {
      try {
        const content = await readFile(this.configPath, "utf-8");
        existingConfig = yaml.load(content) as any;
      } catch (error) {
        console.warn(`Warning: Unable to read existing Continue config, will create new config`);
      }
    }

    // Build new model configuration
    const newModel = {
      title: profile.name,
      provider: continueProvider,
      apiBase: baseURL,
      ...(profile.apiKey && { apiKey: profile.apiKey }), // Only add apiKey when present
      roles: ["chat", "edit", "apply"],
    };

    // Smart merge: update or add model
    const models = existingConfig.models || [];
    const existingIndex = models.findIndex((m: any) => m.title === profile.name);

    if (existingIndex >= 0) {
      // Update existing model
      models[existingIndex] = newModel;
    } else {
      // Add new model
      models.push(newModel);
    }

    const newConfig = {
      ...existingConfig,
      models,
    };

    // Ensure config directory exists
    await mkdir(dirname(this.configPath), { recursive: true });

    // Write YAML configuration
    const content = yaml.dump(newConfig, {
      indent: SERIALIZATION.yamlIndent,
      lineWidth: -1, // No line width limit
      noRefs: true, // Don't use references
    });
    await writeFile(this.configPath, content, "utf-8");
  }

  /**
   * Verify if configuration has been correctly applied
   */
  async verify(profile: ClaudeCodeProfile): Promise<boolean> {
    if (!existsSync(this.configPath)) {
      return false;
    }

    try {
      const content = await readFile(this.configPath, "utf-8");
      const config = yaml.load(content) as any;

      if (!config.models || !Array.isArray(config.models)) {
        return false;
      }

      // Find matching model
      const model = config.models.find((m: any) => m.title === profile.name);
      if (!model) {
        return false;
      }

      const preset = getPresetById(profile.providerId);
      const expectedBaseURL = profile.baseURL || preset?.baseURL || "";

      return model.apiBase === expectedBaseURL;
    } catch (error) {
      return false;
    }
  }

  /**
   * Remove profile from Continue configuration
   * Removes the model entry with matching title from config.yaml
   */
  async remove(profileName: string): Promise<void> {
    if (!existsSync(this.configPath)) {
      return;
    }

    try {
      const content = await readFile(this.configPath, "utf-8");
      const config = yaml.load(content) as any;

      if (!config.models || !Array.isArray(config.models)) {
        return;
      }

      // Remove model with matching title
      const initialLength = config.models.length;
      config.models = config.models.filter((m: any) => m.title !== profileName);

      // Only write if something was actually removed
      if (config.models.length < initialLength) {
        const yamlContent = yaml.dump(config);
        await writeFile(this.configPath, yamlContent, "utf-8");
      }
    } catch (error) {
      // Silently fail - config might be corrupted or in unexpected format
      console.warn(`Failed to remove profile from Continue config: ${error}`);
    }
  }
}
