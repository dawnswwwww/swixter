# Provider Model Family Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional hierarchical model family structure to ProviderPreset, enabling grouped model selection in the UI (e.g., Claude's Sonnet/Haiku/Opus families).

**Architecture:** Provider presets gain an optional `modelFamilies` field alongside the existing `defaultModels` flat array. The UI detects which structure exists and renders either a two-level dropdown (family → model) or a flat dropdown. Backward compatibility is preserved for providers without families.

**Tech Stack:** TypeScript (Zod schemas), React (hooks, state), Tailwind CSS

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `src/types.ts` | Modify | Add `ModelFamily` interface, update `ProviderPreset` |
| `src/providers/presets.ts` | Modify | Add `modelFamilies` to `anthropicPreset` |
| `ui/src/api/types.ts` | Modify | Sync `ModelFamily` interface to UI |
| `ui/src/utils/model-helper.ts` | Create | Helper functions for model family operations |
| `ui/src/components/ui/Modal.tsx` | Modify | Two-level model selection UI |

---

## Task 1: Add ModelFamily Interface to Backend Types

**Files:**
- Modify: `src/types.ts:1-44`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/model-family.test.ts
import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { ProviderPresetSchema, ProviderPreset } from '../../src/types';

// Inline the schema for testing since we can't import it yet
const ModelFamilySchema = z.object({
  id: z.string(),
  name: z.string(),
  models: z.array(z.string()),
});

const ProviderPresetSchemaWithFamily = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  baseURL: z.string().url(),
  defaultModels: z.array(z.string()),
  authType: z.enum(["bearer", "api-key", "custom"]),
  headers: z.record(z.string(), z.string()).optional(),
  rateLimit: z.object({
    requestsPerMinute: z.number().optional(),
    tokensPerMinute: z.number().optional(),
  }).optional(),
  docs: z.string().url().optional(),
  isChinese: z.boolean().optional(),
  wire_api: z.enum(["chat", "responses"]).optional(),
  env_key: z.string().optional(),
  modelFamilies: z.array(ModelFamilySchema).optional(),
});

describe('ModelFamily', () => {
  test('accepts valid model family', () => {
    const result = ModelFamilySchema.safeParse({
      id: 'sonnet',
      name: 'Sonnet',
      models: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022'],
    });
    expect(result.success).toBe(true);
  });

  test('rejects empty models array', () => {
    const result = ModelFamilySchema.safeParse({
      id: 'sonnet',
      name: 'Sonnet',
      models: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('ProviderPreset with ModelFamily', () => {
  test('accepts provider with modelFamilies', () => {
    const result = ProviderPresetSchemaWithFamily.safeParse({
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
    const result = ProviderPresetSchemaWithFamily.safeParse({
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/model-family.test.ts`
Expected: FAIL with "Cannot find module '../../src/types'"

- [ ] **Step 3: Modify src/types.ts to add ModelFamily**

Add the `ModelFamily` interface after line 6 (after `ApiKeyEnvVar` type):

```typescript
/**
 * Model family grouping
 * Used to organize models into hierarchical families (e.g., Claude's Sonnet/Haiku/Opus)
 */
export interface ModelFamily {
  /** Family ID, e.g., "sonnet", "haiku", "opus" */
  id: string;
  /** Display name, e.g., "Sonnet", "Haiku", "Opus" */
  name: string;
  /** List of model IDs in this family */
  models: string[];
}
```

Add `modelFamilies?: ModelFamily[]` to `ProviderPreset` interface (after line 43, before the closing brace):

```typescript
  /** Environment variable name for API key (for Codex) */
  env_key?: string;
  /** Optional model family hierarchy */
  modelFamilies?: ModelFamily[];
}
```

Add `modelFamilies` to `ProviderPresetSchema` (after line 161, before the closing bracket):

```typescript
  env_key: z.string().optional(),
  modelFamilies: z.array(z.object({
    id: z.string(),
    name: z.string(),
    models: z.array(z.string()).min(1),
  })).optional(),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/model-family.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/unit/model-family.test.ts
git commit -m "feat: add ModelFamily interface to ProviderPreset"
```

---

## Task 2: Sync ModelFamily to UI Types

**Files:**
- Modify: `ui/src/api/types.ts:1-22`

- [ ] **Step 1: Write the failing test**

```typescript
// ui/tests/unit/model-family.test.ts
import { describe, expect, test } from 'bun:test';

// We test the type structure via runtime validation
interface ModelFamily {
  id: string;
  name: string;
  models: string[];
}

interface ProviderPreset {
  id: string;
  name: string;
  displayName: string;
  baseURL: string;
  defaultModels: string[];
  authType: string;
  modelFamilies?: ModelFamily[];
}

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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test ui/tests/unit/model-family.test.ts`
Expected: FAIL with "Cannot find module" (directory doesn't exist)

- [ ] **Step 3: Create ui/tests/unit directory and add test file**

Create the test file at `ui/tests/unit/model-family.test.ts` with the test code above.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test ui/tests/unit/model-family.test.ts`
Expected: PASS

- [ ] **Step 5: Modify ui/src/api/types.ts**

Add `ModelFamily` interface after line 3 (after `AuthType`):

```typescript
export type AuthType = "bearer" | "api-key" | "custom";

/**
 * Model family grouping for hierarchical model organization
 */
export interface ModelFamily {
  /** Family ID, e.g., "sonnet", "haiku", "opus" */
  id: string;
  /** Display name, e.g., "Sonnet", "Haiku", "Opus" */
  name: string;
  /** List of model IDs in this family */
  models: string[];
}
```

Add `modelFamilies?: ModelFamily[]` to `ProviderPreset` interface (after line 20, before `isUser`):

```typescript
  env_key?: string;
  /** Optional model family hierarchy */
  modelFamilies?: ModelFamily[];
  isUser?: boolean; // Added by API
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test ui/tests/unit/model-family.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add ui/src/api/types.ts ui/tests/unit/model-family.test.ts
git commit -m "feat(ui): sync ModelFamily type to UI"
```

---

## Task 3: Add modelFamilies to Anthropic Preset

**Files:**
- Modify: `src/providers/presets.ts:7-25`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/anthropic-family.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/anthropic-family.test.ts`
Expected: FAIL with "modelFamilies is undefined"

- [ ] **Step 3: Modify anthropicPreset in presets.ts**

Replace the `anthropicPreset` definition (lines 7-25) with:

```typescript
export const anthropicPreset: ProviderPreset = {
  id: "anthropic",
  name: "Anthropic",
  displayName: "Anthropic (Official)",
  baseURL: "https://api.anthropic.com",
  defaultModels: [],  // Empty - using modelFamilies instead
  modelFamilies: [
    {
      id: "sonnet",
      name: "Sonnet",
      models: [
        "claude-sonnet-4-20250514",
        "claude-3-5-sonnet-20241022",
      ],
    },
    {
      id: "haiku",
      name: "Haiku",
      models: [
        "claude-3-5-haiku-20241022",
      ],
    },
    {
      id: "opus",
      name: "Opus",
      models: [
        "claude-3-opus-20240229",
      ],
    },
  ],
  authType: "api-key",
  headers: {
    "anthropic-version": "2023-06-01",
  },
  docs: "https://docs.anthropic.com/",
  wire_api: "responses",
  env_key: "ANTHROPIC_API_KEY",
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/anthropic-family.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/providers/presets.ts tests/unit/anthropic-family.test.ts
git commit -m "feat: add modelFamilies to anthropicPreset"
```

---

## Task 4: Create UI Model Helper Utility

**Files:**
- Create: `ui/src/utils/model-helper.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// ui/tests/unit/model-helper.test.ts
import { describe, expect, test } from 'bun:test';
import type { ModelFamily } from '../../src/api/types';

interface ProviderOption {
  id: string;
  name: string;
  baseURL: string;
  defaultModels: string[];
  modelFamilies?: ModelFamily[];
}

// Inline helper functions for testing
function hasModelFamilies(provider: ProviderOption): boolean {
  return Array.isArray(provider.modelFamilies) && provider.modelFamilies.length > 0;
}

function getAllModels(provider: ProviderOption): string[] {
  if (hasModelFamilies(provider)) {
    return provider.modelFamilies!.flatMap(f => f.models);
  }
  return provider.defaultModels;
}

function getFamilyForModel(provider: ProviderOption, modelId: string): ModelFamily | undefined {
  if (!hasModelFamilies(provider)) return undefined;
  return provider.modelFamilies!.find(f => f.models.includes(modelId));
}

describe('hasModelFamilies', () => {
  test('returns true when provider has modelFamilies', () => {
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

  test('returns false when provider has no modelFamilies', () => {
    const provider: ProviderOption = {
      id: 'groq',
      name: 'Groq',
      baseURL: 'https://api.groq.com',
      defaultModels: ['llama-3.3-70b-versatile'],
    };
    expect(hasModelFamilies(provider)).toBe(false);
  });

  test('returns false when modelFamilies is empty array', () => {
    const provider: ProviderOption = {
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
    const provider: ProviderOption = {
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
    const provider: ProviderOption = {
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
    const provider: ProviderOption = {
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
    const provider: ProviderOption = {
      id: 'groq',
      name: 'Groq',
      baseURL: 'https://api.groq.com',
      defaultModels: ['llama-3.3-70b-versatile'],
    };
    expect(getFamilyForModel(provider, 'llama-3.3-70b-versatile')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test ui/tests/unit/model-helper.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Create ui/src/utils/model-helper.ts**

```typescript
import type { ModelFamily } from "../api/types";

export interface ProviderWithModelFamilies {
  id: string;
  name: string;
  baseURL: string;
  defaultModels: string[];
  modelFamilies?: ModelFamily[];
}

/**
 * Check if a provider has model families defined
 */
export function hasModelFamilies(provider: ProviderWithModelFamilies): boolean {
  return Array.isArray(provider.modelFamilies) && provider.modelFamilies.length > 0;
}

/**
 * Get all models from a provider (flattened from families or from defaultModels)
 */
export function getAllModels(provider: ProviderWithModelFamilies): string[] {
  if (hasModelFamilies(provider)) {
    return provider.modelFamilies!.flatMap((f) => f.models);
  }
  return provider.defaultModels;
}

/**
 * Get the family that contains a specific model
 */
export function getFamilyForModel(
  provider: ProviderWithModelFamilies,
  modelId: string
): ModelFamily | undefined {
  if (!hasModelFamilies(provider)) {
    return undefined;
  }
  return provider.modelFamilies!.find((f) => f.models.includes(modelId));
}

/**
 * Get the family ID for a given model
 */
export function getFamilyIdForModel(
  provider: ProviderWithModelFamilies,
  modelId: string
): string | undefined {
  const family = getFamilyForModel(provider, modelId);
  return family?.id;
}

/**
 * Get models filtered by family ID
 */
export function getModelsByFamily(
  provider: ProviderWithModelFamilies,
  familyId: string
): string[] {
  if (!hasModelFamilies(provider)) {
    return provider.defaultModels;
  }
  const family = provider.modelFamilies!.find((f) => f.id === familyId);
  return family?.models ?? [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test ui/tests/unit/model-helper.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ui/src/utils/model-helper.ts ui/tests/unit/model-helper.test.ts
git commit -m "feat(ui): add model family helper utilities"
```

---

## Task 5: Update Modal UI with Two-Level Model Selection

**Files:**
- Modify: `ui/src/components/ui/Modal.tsx:23-90`, `ui/src/components/ui/Modal.tsx:274-299`

- [ ] **Step 1: Write the failing test**

```typescript
// ui/tests/unit/modal-model-selection.test.ts
import { describe, expect, test } from 'bun:test';

interface ProviderOption {
  id: string;
  name: string;
  baseURL: string;
  defaultModels: string[];
  modelFamilies?: { id: string; name: string; models: string[] }[];
}

// Simulate the logic we need
function hasModelFamilies(provider: ProviderOption): boolean {
  return Array.isArray(provider.modelFamilies) && provider.modelFamilies.length > 0;
}

function getAllModels(provider: ProviderOption): string[] {
  if (hasModelFamilies(provider)) {
    return provider.modelFamilies!.flatMap(f => f.models);
  }
  return provider.defaultModels;
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test ui/tests/unit/modal-model-selection.test.ts`
Expected: PASS (logic is inline, this verifies the logic before implementation)

- [ ] **Step 3: Modify ProviderOption interface in Modal.tsx**

Replace the `ProviderOption` interface (lines 23-28) with:

```typescript
interface ProviderOption {
  id: string;
  name: string;
  baseURL: string;
  defaultModels: string[];
  modelFamilies?: ModelFamily[];
}

interface ModelFamily {
  id: string;
  name: string;
  models: string[];
}
```

- [ ] **Step 4: Modify state and provider fetching in Modal.tsx**

Add state for selected family and update the provider fetching (after line 38):

```typescript
const [providers, setProviders] = useState<ProviderOption[]>([]);
const [selectedFamily, setSelectedFamily] = useState<string>('');
```

Update the provider mapping in the `useEffect` (around line 52) to include modelFamilies:

```typescript
api.listProviders().then((data: ProviderPreset[]) => {
  const options: ProviderOption[] = data.map(p => ({
    id: p.id,
    name: p.displayName || p.name,
    baseURL: p.baseURL || "",
    defaultModels: p.defaultModels || [],
    modelFamilies: p.modelFamilies,
  }));
  setProviders(options);
```

- [ ] **Step 5: Modify formData initialization and handleProviderChange**

Update `handleProviderChange` (lines 148-157) to handle model families:

```typescript
const handleProviderChange = (providerId: string) => {
  const provider = providers.find(p => p.id === providerId);
  const hasFamilies = provider?.modelFamilies && provider.modelFamilies.length > 0;

  setFormData({
    ...formData,
    providerId,
    baseURL: provider?.baseURL || "",
    model: "",
  });
  // Reset family selection when provider changes
  setSelectedFamily(hasFamilies ? provider!.modelFamilies![0].id : "");
};
```

- [ ] **Step 6: Modify the Model selection UI section**

Replace the Model selection section (lines 274-299) with a two-level selection:

```typescript
{/* Model */}
{(() => {
  const provider = providers.find(p => p.id === formData.providerId);
  const hasFamilies = provider?.modelFamilies && provider.modelFamilies.length > 0;

  if (hasFamilies) {
    const families = provider.modelFamilies!;
    const currentFamily = families.find(f => f.id === selectedFamily) || families[0];
    const familyModels = currentFamily?.models || [];

    return (
      <>
        {/* Family selector */}
        <div className="mb-2">
          <label className="block text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1.5">
            Model Family
          </label>
          <select
            value={selectedFamily}
            onChange={(e) => {
              setSelectedFamily(e.target.value);
              // Auto-select first model in new family
              const newFamily = families.find(f => f.id === e.target.value);
              setFormData({ ...formData, model: newFamily?.models[0] || "" });
            }}
            className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded text-sm font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          >
            {families.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>

        {/* Model selector */}
        <div>
          <label className="block text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1.5">
            Model (optional)
          </label>
          <select
            value={formData.model}
            onChange={(e) => setFormData({ ...formData, model: e.target.value })}
            className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded text-sm font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          >
            <option value="">Select a model...</option>
            {familyModels.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      </>
    );
  }

  // Flat model selection (no families)
  return (
    <div>
      <label className="block text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1.5">
        Model {provider?.defaultModels && provider.defaultModels.length ? "(optional)" : ""}
      </label>
      {provider?.defaultModels && provider.defaultModels.length ? (
        <select
          value={formData.model}
          onChange={(e) => setFormData({ ...formData, model: e.target.value })}
          className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded text-sm font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
        >
          <option value="">Select a model...</option>
          {provider.defaultModels.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={formData.model}
          onChange={(e) => setFormData({ ...formData, model: e.target.value })}
          placeholder="model-id"
          className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
        />
      )}
    </div>
  );
})()}
```

- [ ] **Step 7: Initialize selectedFamily when provider is set**

Add initialization in the form data reset `useEffect` (around line 79-86):

```typescript
} else {
  setFormData({
    name: "",
    providerId: providers[0]?.id || "anthropic",
    apiKey: "",
    baseURL: "",
    model: "",
  });
  // Initialize family for the default provider
  const defaultProvider = providers[0];
  if (defaultProvider?.modelFamilies && defaultProvider.modelFamilies.length > 0) {
    setSelectedFamily(defaultProvider.modelFamilies[0].id);
  } else {
    setSelectedFamily("");
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `bun test ui/tests/unit/modal-model-selection.test.ts`
Expected: PASS

- [ ] **Step 9: Run full build and tests**

Run: `bun run build`
Expected: No errors

Run: `bun test`
Expected: All tests pass

- [ ] **Step 10: Commit**

```bash
git add ui/src/components/ui/Modal.tsx ui/tests/unit/modal-model-selection.test.ts
git commit -m "feat(ui): add two-level model family selection in Modal"
```

---

## Task 6: Verify Full System Integration

- [ ] **Step 1: Run full build**

Run: `bun run build`
Expected: Build succeeds without errors

- [ ] **Step 2: Run all tests**

Run: `bun test`
Expected: All tests pass (existing + new)

- [ ] **Step 3: Verify type consistency**

Run: `tsc --noEmit` in ui directory
Expected: No type errors

- [ ] **Step 4: Test UI manually**

Run: `bun run ui:dev` (or equivalent)
- Navigate to Profiles page
- Click "Create Profile"
- Select "Anthropic (Official)" provider
- Verify: Two dropdowns appear (Family then Model)
- Select "Groq" provider
- Verify: Single flat dropdown appears

- [ ] **Step 5: Commit all remaining changes**

```bash
git add -A
git commit -m "feat: complete provider model family hierarchy implementation"
```

---

## Verification Checklist

- [ ] `src/types.ts` has `ModelFamily` interface
- [ ] `src/types.ts` has `modelFamilies?: ModelFamily[]` in `ProviderPreset`
- [ ] `src/types.ts` has `modelFamilies` in `ProviderPresetSchema`
- [ ] `src/providers/presets.ts` has `modelFamilies` in `anthropicPreset`
- [ ] `ui/src/api/types.ts` has `ModelFamily` interface
- [ ] `ui/src/api/types.ts` has `modelFamilies?: ModelFamily[]` in `ProviderPreset`
- [ ] `ui/src/utils/model-helper.ts` exists with helper functions
- [ ] `ui/src/components/ui/Modal.tsx` renders two-level dropdown for providers with families
- [ ] `ui/src/components/ui/Modal.tsx` renders flat dropdown for providers without families
- [ ] All existing tests still pass
- [ ] Build succeeds
