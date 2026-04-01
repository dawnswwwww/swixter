import { describe, expect, test } from 'bun:test';
import {
  ProviderPresetSchema,
  ModelFamily,
} from '../../src/types.js';

// Test that ProviderPresetSchema accepts modelFamilies
describe('ModelFamily in ProviderPresetSchema', () => {
  test('accepts provider with modelFamilies', () => {
    const result = ProviderPresetSchema.safeParse({
      id: 'anthropic',
      name: 'Anthropic',
      displayName: 'Anthropic (Official)',
      baseURL: 'https://api.anthropic.com',
      defaultModels: [],
      authType: 'api-key',
      wire_api: 'responses',
      env_key: 'ANTHROPIC_API_KEY',
      modelFamilies: [
        { id: 'sonnet', name: 'Sonnet', models: ['claude-sonnet-4-20250514'] },
      ],
    });
    expect(result.success).toBe(true);
  });

  test('accepts provider without modelFamilies (backward compatible)', () => {
    const result = ProviderPresetSchema.safeParse({
      id: 'groq',
      name: 'Groq',
      displayName: 'Groq',
      baseURL: 'https://api.groq.com/openai/v1',
      defaultModels: ['llama-3.3-70b-versatile'],
      authType: 'api-key',
      wire_api: 'chat',
      env_key: 'GROQ_API_KEY',
    });
    expect(result.success).toBe(true);
  });
});

// Test ModelFamily interface directly via its usage
describe('ModelFamily interface usage', () => {
  test('can create ModelFamily object', () => {
    const family: ModelFamily = {
      id: 'sonnet',
      name: 'Sonnet',
      models: ['claude-sonnet-4-20250514'],
    };
    expect(family.id).toBe('sonnet');
    expect(family.models.length).toBeGreaterThan(0);
  });
});
