import { describe, expect, test } from 'bun:test';
import { anthropicPreset } from '../../src/providers/presets';

describe('anthropicPreset modelFamilies', () => {
  test('has modelFamilies defined', () => {
    expect(anthropicPreset.modelFamilies).toBeDefined();
  });

  test('has sonnet, haiku, and opus families', () => {
    const families = anthropicPreset.modelFamilies!;
    const familyIds = families.map(f => f.id);

    expect(familyIds).toContain('sonnet');
    expect(familyIds).toContain('haiku');
    expect(familyIds).toContain('opus');
  });

  test('each family has at least one model', () => {
    const families = anthropicPreset.modelFamilies!;
    for (const family of families) {
      expect(family.models.length).toBeGreaterThan(0);
    }
  });

  test('sonnet family contains claude-sonnet-4', () => {
    const sonnet = anthropicPreset.modelFamilies!.find(f => f.id === 'sonnet');
    expect(sonnet!.models).toContain('claude-sonnet-4-20250514');
  });

  test('defaultModels is empty when modelFamilies is used', () => {
    expect(anthropicPreset.defaultModels).toEqual([]);
  });
});
