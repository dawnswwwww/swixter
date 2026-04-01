import { describe, expect, test } from 'bun:test';
import type { ModelFamily } from '../../src/api/types';
import { hasModelFamilies, getAllModels, getFamilyForModel, getFamilyIdForModel, getModelsByFamily } from '../../src/utils/model-helper';
import type { ProviderWithModelFamilies } from '../../src/utils/model-helper';

describe('hasModelFamilies', () => {
  test('returns true when provider has modelFamilies', () => {
    const provider: ProviderWithModelFamilies = {
      id: 'anthropic',
      name: 'Anthropic',
      baseURL: 'https://api.anthropic.com',
      defaultModels: [],
      modelFamilies: [
        { id: 'sonnet', name: 'Sonnet', models: ['claude-sonnet-4'] },
      ],
    };
    expect(hasModelFamilies(provider)).toBe(true);
  });

  test('returns false when provider has no modelFamilies', () => {
    const provider: ProviderWithModelFamilies = {
      id: 'groq',
      name: 'Groq',
      baseURL: 'https://api.groq.com',
      defaultModels: ['llama-3.3-70b-versatile'],
    };
    expect(hasModelFamilies(provider)).toBe(false);
  });

  test('returns false when modelFamilies is empty array', () => {
    const provider: ProviderWithModelFamilies = {
      id: 'test',
      name: 'Test',
      baseURL: 'https://test.com',
      defaultModels: ['model-1'],
      modelFamilies: [],
    };
    expect(hasModelFamilies(provider)).toBe(false);
  });
});

describe('getAllModels', () => {
  test('flattens modelFamilies to all models', () => {
    const provider: ProviderWithModelFamilies = {
      id: 'anthropic',
      name: 'Anthropic',
      baseURL: 'https://api.anthropic.com',
      defaultModels: [],
      modelFamilies: [
        { id: 'sonnet', name: 'Sonnet', models: ['claude-sonnet-4'] },
        { id: 'haiku', name: 'Haiku', models: ['claude-haiku-3'] },
      ],
    };
    expect(getAllModels(provider)).toEqual(['claude-sonnet-4', 'claude-haiku-3']);
  });

  test('returns defaultModels when no modelFamilies', () => {
    const provider: ProviderWithModelFamilies = {
      id: 'groq',
      name: 'Groq',
      baseURL: 'https://api.groq.com',
      defaultModels: ['llama-3.3-70b-versatile', 'gemma2-9b-it'],
    };
    expect(getAllModels(provider)).toEqual(['llama-3.3-70b-versatile', 'gemma2-9b-it']);
  });
});

describe('getFamilyForModel', () => {
  test('finds family for a given model', () => {
    const provider: ProviderWithModelFamilies = {
      id: 'anthropic',
      name: 'Anthropic',
      baseURL: 'https://api.anthropic.com',
      defaultModels: [],
      modelFamilies: [
        { id: 'sonnet', name: 'Sonnet', models: ['claude-sonnet-4'] },
        { id: 'haiku', name: 'Haiku', models: ['claude-haiku-3'] },
      ],
    };
    const family = getFamilyForModel(provider, 'claude-haiku-3');
    expect(family!.id).toBe('haiku');
    expect(family!.name).toBe('Haiku');
  });

  test('returns undefined when no modelFamilies', () => {
    const provider: ProviderWithModelFamilies = {
      id: 'groq',
      name: 'Groq',
      baseURL: 'https://api.groq.com',
      defaultModels: ['llama-3.3-70b-versatile'],
    };
    expect(getFamilyForModel(provider, 'llama-3.3-70b-versatile')).toBeUndefined();
  });
});

describe('getFamilyIdForModel', () => {
  test('returns family id for a given model', () => {
    const provider: ProviderWithModelFamilies = {
      id: 'anthropic',
      name: 'Anthropic',
      baseURL: 'https://api.anthropic.com',
      defaultModels: [],
      modelFamilies: [
        { id: 'sonnet', name: 'Sonnet', models: ['claude-sonnet-4'] },
        { id: 'haiku', name: 'Haiku', models: ['claude-haiku-3'] },
      ],
    };
    expect(getFamilyIdForModel(provider, 'claude-haiku-3')).toBe('haiku');
    expect(getFamilyIdForModel(provider, 'claude-sonnet-4')).toBe('sonnet');
  });

  test('returns undefined when no modelFamilies', () => {
    const provider: ProviderWithModelFamilies = {
      id: 'groq',
      name: 'Groq',
      baseURL: 'https://api.groq.com',
      defaultModels: ['llama-3.3-70b-versatile'],
    };
    expect(getFamilyIdForModel(provider, 'llama-3.3-70b-versatile')).toBeUndefined();
  });
});

describe('getModelsByFamily', () => {
  test('returns models for a given family id', () => {
    const provider: ProviderWithModelFamilies = {
      id: 'anthropic',
      name: 'Anthropic',
      baseURL: 'https://api.anthropic.com',
      defaultModels: [],
      modelFamilies: [
        { id: 'sonnet', name: 'Sonnet', models: ['claude-sonnet-4', 'claude-3-5-sonnet-20241022'] },
        { id: 'haiku', name: 'Haiku', models: ['claude-3-5-haiku-20241022'] },
      ],
    };
    expect(getModelsByFamily(provider, 'sonnet')).toEqual(['claude-sonnet-4', 'claude-3-5-sonnet-20241022']);
    expect(getModelsByFamily(provider, 'haiku')).toEqual(['claude-3-5-haiku-20241022']);
  });

  test('returns defaultModels when no modelFamilies', () => {
    const provider: ProviderWithModelFamilies = {
      id: 'groq',
      name: 'Groq',
      baseURL: 'https://api.groq.com',
      defaultModels: ['llama-3.3-70b-versatile', 'gemma2-9b-it'],
    };
    expect(getModelsByFamily(provider, 'any-family')).toEqual(['llama-3.3-70b-versatile', 'gemma2-9b-it']);
  });

  test('returns empty array when family not found', () => {
    const provider: ProviderWithModelFamilies = {
      id: 'anthropic',
      name: 'Anthropic',
      baseURL: 'https://api.anthropic.com',
      defaultModels: [],
      modelFamilies: [
        { id: 'sonnet', name: 'Sonnet', models: ['claude-sonnet-4'] },
      ],
    };
    expect(getModelsByFamily(provider, 'nonexistent')).toEqual([]);
  });
});
