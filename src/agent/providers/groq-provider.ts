import Groq from 'groq-sdk'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { GroqQuotaSnapshot, NixSettings } from '../../shared/contracts'
import { estimateRequestTokens } from '../context/context-budget'
import type { ModelEvent, ModelProvider, ModelRequest, ModelToolDefinition, ReasoningEffort } from './model-provider'

interface GroqDeltaToolCall {
  index: number
  id?: string
  function?: { name?: string; arguments?: string }
}

interface GroqStreamChunk {
  choices?: Array<{ delta?: { content?: string | null; tool_calls?: GroqDeltaToolCall[] } }>
}

interface HeadersLike {
  get(name: string): string | null
}

interface GroqStreamResponse {
  stream: AsyncIterable<unknown>
  headers?: HeadersLike
}

export interface GroqClientLike {
  chat: {
    completions: {
      create(body: unknown, options?: { signal?: AbortSignal }): Promise<GroqStreamResponse>
    }
  }
}

export type ModelProviderErrorCode = 'AUTHENTICATION_ERROR' | 'RATE_LIMITED' | 'CANCELLED' | 'PROVIDER_ERROR'

export class ModelProviderError extends Error {
  constructor(public readonly code: ModelProviderErrorCode, message: string) {
    super(message)
    this.name = 'ModelProviderError'
  }
}

interface UsageState {
  date: string
  requestsToday: number
  estimatedTokensToday: number
  lastUpdatedAt?: string
  model?: string
  activeReasoning?: ReasoningEffort
  requestLimit?: number
  requestsRemaining?: number
  requestReset?: string
  tokenLimit?: number
  tokensRemaining?: number
  tokenReset?: string
}

export class GroqProvider implements ModelProvider {
  private readonly client: GroqClientLike
  private usage: UsageState = freshUsageState()
  private readonly ready: Promise<void>
  private persistQueue: Promise<void> = Promise.resolve()

  constructor(options: { client?: GroqClientLike; apiKey?: string; getSettings?: () => NixSettings; usageFilePath?: string } = {}) {
    this.client = options.client ?? createClient(options.apiKey)
    this.getSettings = options.getSettings
    this.usageFilePath = options.usageFilePath
    this.ready = this.loadPersistedUsage()
  }

  private readonly getSettings?: () => NixSettings
  private readonly usageFilePath?: string

  getQuotaSnapshot(): GroqQuotaSnapshot {
    this.rotateUsageDay()
    const settings = this.settings()
    return {
      plan: settings.groqFreeTierMode ? 'free' : 'custom',
      lastUpdatedAt: this.usage.lastUpdatedAt,
      model: this.usage.model,
      activeReasoning: this.usage.activeReasoning,
      server: {
        requestsPerDay: { limit: this.usage.requestLimit, remaining: this.usage.requestsRemaining, reset: this.usage.requestReset },
        tokensPerMinute: { limit: this.usage.tokenLimit, remaining: this.usage.tokensRemaining, reset: this.usage.tokenReset }
      },
      local: {
        date: this.usage.date,
        requestsToday: this.usage.requestsToday,
        estimatedTokensToday: this.usage.estimatedTokensToday,
        configuredDailyTokenLimit: settings.groqDailyTokenLimit
      },
      policy: {
        freeTierMode: settings.groqFreeTierMode,
        protection: settings.quotaProtection,
        contextTokenBudget: settings.contextTokenBudget,
        maxCompletionTokens: settings.maxCompletionTokens
      }
    }
  }

  async * stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    try {
      await this.ready
      this.rotateUsageDay()
      const settings = this.settings()
      const inputTokens = estimateRequestTokens(request.messages, request.tools)
      let reasoningEffort = request.reasoningEffort ?? 'medium'
      let maxCompletionTokens = Math.max(1, Math.trunc(request.maxCompletionTokens ?? settings.maxCompletionTokens))

      if (settings.groqFreeTierMode && settings.quotaProtection === 'adaptive') {
        await this.waitForMinuteWindowIfUseful(inputTokens + maxCompletionTokens, signal)
        reasoningEffort = adaptReasoning(reasoningEffort, this.usage, settings)
        maxCompletionTokens = adaptCompletionBudget(maxCompletionTokens, inputTokens, this.usage, settings)
      }

      const groqTools = request.tools?.map(relaxToolDefinitionForGroq)
      const body: Record<string, unknown> = {
        model: normalizeModelId(request.model),
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
          name: message.name,
          tool_call_id: message.toolCallId,
          tool_calls: message.toolCalls?.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.arguments }
          }))
        })),
        tools: groqTools,
        tool_choice: request.tools?.length ? (request.toolChoice ?? 'auto') : undefined,
        // Groq may otherwise reject a model-generated call before NIX can return a
        // recoverable INVALID_ARGUMENTS tool result. NIX keeps strict Zod validation
        // locally in ToolRegistry, so provider-side validation is advisory only.
        disable_tool_validation: request.tools?.length ? true : undefined,
        temperature: request.temperature,
        response_format: request.responseFormat ? { type: request.responseFormat } : undefined,
        reasoning_effort: supportsReasoning(request.model) ? reasoningEffort : undefined,
        reasoning_format: supportsReasoning(request.model) ? 'hidden' : undefined,
        max_completion_tokens: maxCompletionTokens,
        stream: true
      }

      let response: GroqStreamResponse
      try {
        response = await this.client.chat.completions.create(body, { signal })
      } catch (error) {
        const failedTool = toolValidationToolName(error)
        if (!failedTool || !request.tools?.length) throw error

        // A malformed tool call is a model-generation problem, not a fatal agent
        // error. Retry once with only the offending function schema opened up; the
        // returned arguments are still validated and repaired locally by NIX.
        this.usage.requestsToday += 1
        response = await this.client.chat.completions.create({
          ...body,
          tools: groqTools?.map((tool) => tool.function.name === failedTool ? openToolDefinition(tool) : tool),
          temperature: Math.min(request.temperature ?? 0.2, 0.2),
          disable_tool_validation: true
        }, { signal })
      }

      this.updateHeaders(response.headers)
      this.usage.model = normalizeModelId(request.model)
      this.usage.activeReasoning = reasoningEffort
      this.usage.lastUpdatedAt = new Date().toISOString()

      const calls = new Map<number, { id: string; name: string; arguments: string }>()
      let outputCharacters = 0
      for await (const rawChunk of response.stream) {
        if (signal.aborted) throw abortError()
        const chunk = rawChunk as GroqStreamChunk
        const delta = chunk.choices?.[0]?.delta
        if (delta?.content) {
          outputCharacters += delta.content.length
          yield { type: 'text-delta', delta: delta.content }
        }
        for (const partial of delta?.tool_calls ?? []) {
          const current = calls.get(partial.index) ?? { id: '', name: '', arguments: '' }
          current.id += partial.id ?? ''
          current.name += partial.function?.name ?? ''
          current.arguments += partial.function?.arguments ?? ''
          outputCharacters += (partial.function?.arguments?.length ?? 0) + (partial.function?.name?.length ?? 0)
          calls.set(partial.index, current)
        }
      }
      for (const call of [...calls.entries()].sort(([left], [right]) => left - right).map(([, value]) => value)) {
        yield { type: 'tool-call', ...call }
      }
      this.recordEstimatedUsage(inputTokens, outputCharacters, reasoningEffort)
      await this.persistUsage()
      yield { type: 'completed' }
    } catch (error) {
      throw normalizeError(error)
    }
  }

  private settings(): NixSettings {
    return this.getSettings?.() ?? fallbackSettings()
  }

  private rotateUsageDay(): void {
    const today = localDateKey()
    if (this.usage.date === today) return
    const server = {
      requestLimit: this.usage.requestLimit,
      requestsRemaining: this.usage.requestsRemaining,
      requestReset: this.usage.requestReset,
      tokenLimit: this.usage.tokenLimit,
      tokensRemaining: this.usage.tokensRemaining,
      tokenReset: this.usage.tokenReset
    }
    this.usage = { ...freshUsageState(), ...server }
  }

  private updateHeaders(headers?: HeadersLike): void {
    if (!headers) return
    this.usage.requestLimit = headerNumber(headers, 'x-ratelimit-limit-requests') ?? this.usage.requestLimit
    this.usage.requestsRemaining = headerNumber(headers, 'x-ratelimit-remaining-requests') ?? this.usage.requestsRemaining
    this.usage.requestReset = headers.get('x-ratelimit-reset-requests') ?? this.usage.requestReset
    this.usage.tokenLimit = headerNumber(headers, 'x-ratelimit-limit-tokens') ?? this.usage.tokenLimit
    this.usage.tokensRemaining = headerNumber(headers, 'x-ratelimit-remaining-tokens') ?? this.usage.tokensRemaining
    this.usage.tokenReset = headers.get('x-ratelimit-reset-tokens') ?? this.usage.tokenReset
  }

  private recordEstimatedUsage(inputTokens: number, outputCharacters: number, effort: ReasoningEffort): void {
    const visibleOutput = Math.max(0, Math.ceil(outputCharacters / 4))
    const reasoningMultiplier = effort === 'high' ? 2.2 : effort === 'medium' ? 1.5 : 1.15
    const reasoningFloor = effort === 'high' ? 900 : effort === 'medium' ? 450 : 150
    const estimatedCompletion = Math.max(reasoningFloor, Math.ceil(visibleOutput * reasoningMultiplier))
    this.usage.requestsToday += 1
    this.usage.estimatedTokensToday += inputTokens + estimatedCompletion
    this.usage.lastUpdatedAt = new Date().toISOString()
  }

  private async waitForMinuteWindowIfUseful(estimatedRequestTokens: number, signal: AbortSignal): Promise<void> {
    if (this.usage.tokensRemaining === undefined || this.usage.tokensRemaining >= estimatedRequestTokens) return
    const waitMs = parseResetDurationMs(this.usage.tokenReset)
    if (waitMs === undefined || waitMs > 65_000) return
    await sleep(waitMs + 100, signal)
    if (this.usage.tokenLimit !== undefined) this.usage.tokensRemaining = this.usage.tokenLimit
  }

  private async loadPersistedUsage(): Promise<void> {
    if (!this.usageFilePath) return
    try {
      const stored = JSON.parse(await readFile(this.usageFilePath, 'utf8')) as Partial<UsageState>
      if (stored.date === localDateKey()) {
        this.usage = {
          ...this.usage,
          date: stored.date,
          requestsToday: Math.max(0, Number(stored.requestsToday) || 0),
          estimatedTokensToday: Math.max(0, Number(stored.estimatedTokensToday) || 0),
          lastUpdatedAt: typeof stored.lastUpdatedAt === 'string' ? stored.lastUpdatedAt : undefined
        }
      }
    } catch { /* first run or an invalid ledger must never block the agent */ }
  }

  private persistUsage(): Promise<void> {
    if (!this.usageFilePath) return Promise.resolve()
    const payload = JSON.stringify({
      date: this.usage.date,
      requestsToday: this.usage.requestsToday,
      estimatedTokensToday: this.usage.estimatedTokensToday,
      lastUpdatedAt: this.usage.lastUpdatedAt
    }, null, 2)
    this.persistQueue = this.persistQueue.then(async () => {
      await mkdir(dirname(this.usageFilePath!), { recursive: true })
      const tmp = `${this.usageFilePath}.tmp`
      await writeFile(tmp, payload, 'utf8')
      await rename(tmp, this.usageFilePath!)
    }).catch(() => undefined)
    return this.persistQueue
  }
}

function createClient(apiKey?: string): GroqClientLike {
  const groq = new Groq({ apiKey: apiKey ?? process.env.GROQ_API_KEY })
  return {
    chat: {
      completions: {
        create: async (body, options) => {
          const pending = groq.chat.completions.create(
            body as Parameters<typeof groq.chat.completions.create>[0] & { stream: true },
            { signal: options?.signal }
          ) as unknown as { withResponse(): Promise<{ data: AsyncIterable<unknown>; response: Response }> }
          const { data, response } = await pending.withResponse()
          return { stream: data, headers: response.headers }
        }
      }
    }
  }
}


function relaxToolDefinitionForGroq(tool: ModelToolDefinition): ModelToolDefinition {
  return {
    ...tool,
    function: {
      ...tool.function,
      parameters: relaxJsonSchemaForProvider(tool.function.parameters)
    }
  }
}

function relaxJsonSchemaForProvider(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const output: Record<string, unknown> = {}
  const providerOnlyConstraints = new Set([
    'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
    'multipleOf', 'minItems', 'maxItems', 'uniqueItems', 'pattern', 'format', 'required',
    'additionalProperties'
  ])
  for (const [key, item] of Object.entries(source)) {
    if (providerOnlyConstraints.has(key)) continue
    if (key === 'properties' && item && typeof item === 'object' && !Array.isArray(item)) {
      output.properties = Object.fromEntries(Object.entries(item as Record<string, unknown>).map(([name, schema]) => [
        name,
        schema && typeof schema === 'object' && !Array.isArray(schema) ? relaxJsonSchemaForProvider(schema) : schema
      ]))
      continue
    }
    if (key === 'items' && item && typeof item === 'object' && !Array.isArray(item)) {
      output.items = relaxJsonSchemaForProvider(item)
      continue
    }
    if ((key === 'anyOf' || key === 'oneOf' || key === 'allOf') && Array.isArray(item)) {
      output[key] = item.map((schema) => schema && typeof schema === 'object' && !Array.isArray(schema) ? relaxJsonSchemaForProvider(schema) : schema)
      continue
    }
    output[key] = item
  }
  return output
}

function openToolDefinition(tool: ModelToolDefinition): ModelToolDefinition {
  return {
    ...tool,
    function: {
      ...tool.function,
      parameters: { type: 'object', additionalProperties: true }
    }
  }
}

function toolValidationToolName(error: unknown): string | undefined {
  const detail = providerErrorDetail(error)
  if (!detail || !/tool call validation failed/i.test(detail)) return undefined
  return detail.match(/parameters for tool\s+([A-Za-z0-9_.:-]+)/i)?.[1]
}

function adaptReasoning(requested: ReasoningEffort, usage: UsageState, settings: NixSettings): ReasoningEffort {
  const dailyRatio = usage.estimatedTokensToday / Math.max(1, settings.groqDailyTokenLimit)
  const remaining = usage.tokensRemaining
  if (dailyRatio >= 0.9 || (remaining !== undefined && remaining < 1_800)) return 'low'
  if (requested === 'high' && (dailyRatio >= 0.72 || (remaining !== undefined && remaining < 3_500))) return 'medium'
  return requested
}

function adaptCompletionBudget(requested: number, inputTokens: number, usage: UsageState, settings: NixSettings): number {
  let value = requested
  const dailyRatio = usage.estimatedTokensToday / Math.max(1, settings.groqDailyTokenLimit)
  if (dailyRatio >= 0.9) value = Math.min(value, 1_200)
  else if (dailyRatio >= 0.75) value = Math.min(value, 1_700)
  if (usage.tokensRemaining !== undefined) {
    const safeRemaining = Math.max(600, usage.tokensRemaining - inputTokens - 250)
    value = Math.min(value, safeRemaining)
  }
  return Math.max(600, Math.trunc(value))
}

function supportsReasoning(model: string): boolean {
  const normalized = normalizeModelId(model)
  return normalized === 'openai/gpt-oss-120b' || normalized === 'openai/gpt-oss-20b'
}

function normalizeModelId(value: string): string {
  if (value === 'openai/gpt-oss-120') return 'openai/gpt-oss-120b'
  if (value === 'openai/gpt-oss-20') return 'openai/gpt-oss-20b'
  return value
}

function freshUsageState(): UsageState {
  return { date: localDateKey(), requestsToday: 0, estimatedTokensToday: 0 }
}

function localDateKey(): string {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function fallbackSettings(): NixSettings {
  return {
    fastModel: 'openai/gpt-oss-120b', deepModel: 'openai/gpt-oss-120b', contextMaxCharacters: 140_000,
    contextTokenBudget: 3_600, maxCompletionTokens: 2_200, maxConcurrentRuns: 1, autoVerify: true,
    skillMode: 'auto', superpowersEnabled: true, modelRouting: 'auto', reasoningMode: 'auto',
    groqFreeTierMode: true, quotaProtection: 'adaptive', groqDailyTokenLimit: 200_000
  }
}

function headerNumber(headers: HeadersLike, name: string): number | undefined {
  const value = headers.get(name)
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseResetDurationMs(value?: string): number | undefined {
  if (!value) return undefined
  let total = 0
  let matched = false
  for (const match of value.matchAll(/([0-9]*\.?[0-9]+)\s*(ms|s|m|h)/gi)) {
    matched = true
    const amount = Number(match[1])
    const unit = match[2].toLowerCase()
    total += amount * (unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : unit === 's' ? 1_000 : 1)
  }
  return matched ? Math.ceil(total) : undefined
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError())
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
    const onAbort = (): void => { clearTimeout(timer); reject(abortError()) }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function normalizeError(error: unknown): ModelProviderError {
  if (error instanceof ModelProviderError) return error
  if (error instanceof Error && (error.name === 'AbortError' || ('code' in error && error.code === 'ABORT_ERR'))) {
    return new ModelProviderError('CANCELLED', 'Groq request was cancelled')
  }
  const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : undefined
  if (status === 401 || status === 403) return new ModelProviderError('AUTHENTICATION_ERROR', 'Groq authentication failed')
  if (status === 429) {
    const retryAfter = error && typeof error === 'object' && 'headers' in error
      ? getHeader((error as { headers?: HeadersLike }).headers, 'retry-after')
      : undefined
    return new ModelProviderError('RATE_LIMITED', retryAfter ? `Groq rate limit reached. Try again in about ${retryAfter}s.` : 'Groq rate limit reached')
  }
  const detail = providerErrorDetail(error)
  if (status === 413) return new ModelProviderError('PROVIDER_ERROR', `Groq request is too large for the current limit${detail ? `: ${detail}` : ''}`)
  if (status && status >= 500) return new ModelProviderError('PROVIDER_ERROR', `Groq is temporarily unavailable (${status})${detail ? `: ${detail}` : ''}`)
  if (status) return new ModelProviderError('PROVIDER_ERROR', `Groq rejected the request (${status})${detail ? `: ${detail}` : ''}`)
  return new ModelProviderError('PROVIDER_ERROR', detail ? `Groq request failed: ${detail}` : 'Groq request failed')
}

function providerErrorDetail(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return error instanceof Error ? sanitizeProviderText(error.message) : undefined
  const record = error as Record<string, unknown>
  const nested = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : undefined
  const failedGeneration = nested?.failed_generation && typeof nested.failed_generation === 'object'
    ? nested.failed_generation as Record<string, unknown>
    : undefined
  const candidates = [failedGeneration?.reason, nested?.message, record.message, error instanceof Error ? error.message : undefined]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return sanitizeProviderText(candidate)
  }
  return undefined
}

function sanitizeProviderText(value: string): string {
  return value
    .replace(/(?:sk|gsk)_[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 700)
}

function getHeader(headers: HeadersLike | undefined, name: string): string | undefined {
  return headers?.get(name) ?? undefined
}

function abortError(): Error {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}
