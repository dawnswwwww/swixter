import { describe, expect, test } from 'bun:test';
import type { ModelFamily, ProviderPreset } from '../../src/api/types';

describe('ModelFamily type structure', () => {
  test('has required fields', () => {
    const family: ModelFamily = {
      id: 'sonnet',
      name: 'Sonnet',
      models: ['claude-sonnet-4-20250514'],
    };
    expect(family.id).toBe('sonnet');
    expect(family.name).toBe('Sonnet');
    expect(family.models).toHaveLength(1);
  });

  test('provider preset supports optional modelFamilies', () => {
    const provider: ProviderPreset = {
      id: 'anthropic',
      name: 'Anthropic',
      displayName: 'Anthropic',
      baseURL: 'https://api.anthropic.com',
      defaultModels: [],
      authType: 'api-key',
      modelFamilies: [
        { id: 'sonnet', name: 'Sonnet', models: ['claude-sonnet-4-20250514'] },
      ],
    };
    expect(provider.modelFamilies).toBeDefined();
    expect(provider.modelFamilies![0].id).toBe('sonnet');
  });

  test('multiple families can coexist', () => {
    const provider: ProviderPreset = {
      id: 'anthropic',
      name: 'Anthropic',
      displayName: 'Anthropic',
      baseURL: 'https://api.anthropic.com',
      defaultModels: [],
      authType: 'api-key',
      modelFamilies: [
        { id: 'sonnet', name: 'Sonnet', models: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022'] },
        { id: 'haiku', name: 'Haiku', models: ['claude-3-5-haiku-20241022'] },
        { id: 'opus', name: 'Opus', models: ['claude-3-opus-20240229'] },
      ],
    };
    expect(provider.modelFamilies).toHaveLength(3);
    expect(provider.modelFamilies![1].id).toBe('haiku');
  });
});
