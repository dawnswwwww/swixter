import { describe, expect, test } from 'bun:test';

interface ModelFamily {
  id: string;
  name: string;
  models: string[];
}

interface ProviderOption {
  id: string;
  name: string;
  baseURL: string;
  defaultModels: string[];
  modelFamilies?: ModelFamily[];
}

function hasModelFamilies(provider: ProviderOption): boolean {
  return Array.isArray(provider.modelFamilies) && provider.modelFamilies.length > 0;
}

function getAllModels(provider: ProviderOption): string[] {
  if (hasModelFamilies(provider)) {
    return provider.modelFamilies!.flatMap(f => f.models);
  }
  return provider.defaultModels;
}

function getModelsByFamily(provider: ProviderOption, familyId: string): string[] {
  if (!hasModelFamilies(provider)) {
    return provider.defaultModels;
  }
  const family = provider.modelFamilies!.find(f => f.id === familyId);
  return family?.models ?? [];
}

describe('Modal model selection logic', () => {
  describe('hasModelFamilies', () => {
    test('provider with modelFamilies returns true', () => {
      const provider: ProviderOption = {
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

    test('provider without modelFamilies returns false', () => {
      const provider: ProviderOption = {
        id: 'groq',
        name: 'Groq',
        baseURL: 'https://api.groq.com',
        defaultModels: ['llama-3.3-70b-versatile'],
      };
      expect(hasModelFamilies(provider)).toBe(false);
    });
  });

  describe('getAllModels', () => {
    test('flattens models from families', () => {
      const provider: ProviderOption = {
        id: 'anthropic',
        name: 'Anthropic',
        baseURL: 'https://api.anthropic.com',
        defaultModels: [],
        modelFamilies: [
          { id: 'sonnet', name: 'Sonnet', models: ['claude-sonnet-4', 'claude-sonnet-3'] },
          { id: 'haiku', name: 'Haiku', models: ['claude-haiku-3'] },
        ],
      };
      expect(getAllModels(provider)).toEqual([
        'claude-sonnet-4',
        'claude-sonnet-3',
        'claude-haiku-3',
      ]);
    });

    test('returns defaultModels when no families', () => {
      const provider: ProviderOption = {
        id: 'groq',
        name: 'Groq',
        baseURL: 'https://api.groq.com',
        defaultModels: ['llama-3.3-70b-versatile', 'gemma2-9b-it'],
      };
      expect(getAllModels(provider)).toEqual(['llama-3.3-70b-versatile', 'gemma2-9b-it']);
    });
  });

  describe('getModelsByFamily', () => {
    test('returns models for specified family', () => {
      const provider: ProviderOption = {
        id: 'anthropic',
        name: 'Anthropic',
        baseURL: 'https://api.anthropic.com',
        defaultModels: [],
        modelFamilies: [
          { id: 'sonnet', name: 'Sonnet', models: ['claude-sonnet-4', 'claude-sonnet-3'] },
          { id: 'haiku', name: 'Haiku', models: ['claude-haiku-3'] },
        ],
      };
      expect(getModelsByFamily(provider, 'sonnet')).toEqual(['claude-sonnet-4', 'claude-sonnet-3']);
      expect(getModelsByFamily(provider, 'haiku')).toEqual(['claude-haiku-3']);
    });

    test('returns defaultModels when no families', () => {
      const provider: ProviderOption = {
        id: 'groq',
        name: 'Groq',
        baseURL: 'https://api.groq.com',
        defaultModels: ['llama-3.3-70b-versatile'],
      };
      expect(getModelsByFamily(provider, 'any')).toEqual(['llama-3.3-70b-versatile']);
    });
  });
});