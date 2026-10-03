import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { NixSettings, QuotaProtectionMode, ReasoningMode } from '../../shared/contracts'

const defaults = (environment: NodeJS.ProcessEnv = process.env): NixSettings => {
  const freeTier = environment.GROQ_FREE_TIER_MODE !== 'false'
  return {
    fastModel: normalizeModelId(environment.GROQ_FAST_MODEL || 'openai/gpt-oss-120b'),
    deepModel: normalizeModelId(environment.GROQ_DEEP_MODEL || 'openai/gpt-oss-120b'),
    contextMaxCharacters: readNumber(environment.NIX_CONTEXT_MAX_CHARACTERS, 140_000),
    contextTokenBudget: readNumber(environment.NIX_CONTEXT_TOKEN_BUDGET, freeTier ? 3_600 : 24_000),
    maxCompletionTokens: readNumber(environment.NIX_MAX_COMPLETION_TOKENS, freeTier ? 2_200 : 8_000),
    maxConcurrentRuns: readNumber(environment.NIX_MAX_CONCURRENT_RUNS, freeTier ? 1 : 2),
    autoVerify: true,
    skillMode: 'auto',
    superpowersEnabled: true,
    modelRouting: 'auto',
    reasoningMode: readReasoningMode(environment.NIX_REASONING_MODE),
    groqFreeTierMode: freeTier,
    quotaProtection: readQuotaProtection(environment.NIX_QUOTA_PROTECTION),
    groqDailyTokenLimit: readNumber(environment.GROQ_DAILY_TOKEN_LIMIT, 200_000)
  }
}

export class SettingsStore {
  private settings: NixSettings

  private constructor(private readonly path: string, settings: NixSettings) { this.settings = settings }

  static async open(path: string): Promise<SettingsStore> {
    let stored: Partial<NixSettings> = {}
    try { stored = JSON.parse(await readFile(path, 'utf8')) as Partial<NixSettings> } catch { /* first launch */ }
    return new SettingsStore(path, sanitize({ ...defaults(), ...stored } as NixSettings))
  }

  get(): NixSettings { return { ...this.settings } }

  async update(patch: Partial<NixSettings>): Promise<NixSettings> {
    this.settings = sanitize({ ...this.settings, ...patch })
    await mkdir(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    await writeFile(tmp, JSON.stringify(this.settings, null, 2), 'utf8')
    await rename(tmp, this.path)
    return this.get()
  }
}

function sanitize(value: NixSettings): NixSettings {
  const fallback = defaults()
  const groqFreeTierMode = Boolean(value.groqFreeTierMode)
  let contextTokenBudget = clamp(value.contextTokenBudget, 800, 100_000, groqFreeTierMode ? 3_600 : fallback.contextTokenBudget)
  let maxCompletionTokens = clamp(value.maxCompletionTokens, 400, 65_536, groqFreeTierMode ? 2_200 : fallback.maxCompletionTokens)
  if (groqFreeTierMode) {
    contextTokenBudget = Math.min(contextTokenBudget, 5_200)
    maxCompletionTokens = Math.min(maxCompletionTokens, 3_000)
    if (contextTokenBudget + maxCompletionTokens > 7_000) maxCompletionTokens = Math.max(600, 7_000 - contextTokenBudget)
  }
  return {
    fastModel: normalizeModelId(String(value.fastModel || fallback.fastModel)),
    deepModel: normalizeModelId(String(value.deepModel || fallback.deepModel)),
    contextMaxCharacters: clamp(value.contextMaxCharacters, 20_000, 500_000, fallback.contextMaxCharacters),
    contextTokenBudget,
    maxCompletionTokens,
    maxConcurrentRuns: groqFreeTierMode ? 1 : clamp(value.maxConcurrentRuns, 1, 8, fallback.maxConcurrentRuns),
    autoVerify: Boolean(value.autoVerify),
    skillMode: value.skillMode === 'off' ? 'off' : 'auto',
    superpowersEnabled: Boolean(value.superpowersEnabled),
    modelRouting: value.modelRouting === 'fast' || value.modelRouting === 'deep' ? value.modelRouting : 'auto',
    reasoningMode: isReasoningMode(value.reasoningMode) ? value.reasoningMode : 'auto',
    groqFreeTierMode,
    quotaProtection: isQuotaProtection(value.quotaProtection) ? value.quotaProtection : 'adaptive',
    groqDailyTokenLimit: clamp(value.groqDailyTokenLimit, 10_000, 100_000_000, 200_000)
  }
}

function normalizeModelId(value: string): string {
  const trimmed = value.trim()
  if (trimmed === 'openai/gpt-oss-120') return 'openai/gpt-oss-120b'
  if (trimmed === 'openai/gpt-oss-20') return 'openai/gpt-oss-20b'
  return trimmed
}

function isReasoningMode(value: unknown): value is ReasoningMode {
  return value === 'auto' || value === 'low' || value === 'medium' || value === 'high'
}

function isQuotaProtection(value: unknown): value is QuotaProtectionMode {
  return value === 'adaptive' || value === 'monitor' || value === 'off'
}

function readReasoningMode(value: string | undefined): ReasoningMode {
  return isReasoningMode(value) ? value : 'auto'
}

function readQuotaProtection(value: string | undefined): QuotaProtectionMode {
  return isQuotaProtection(value) ? value : 'adaptive'
}

function readNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value)
  const safe = Number.isFinite(parsed) ? parsed : fallback
  return Math.max(min, Math.min(max, Math.trunc(safe)))
}
