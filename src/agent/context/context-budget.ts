import type { ModelMessage, ModelToolDefinition } from '../providers/model-provider'

const DEFAULT_CHARS_PER_TOKEN = 4

export function estimateTextTokens(value: string): number {
  if (!value) return 0
  return Math.max(1, Math.ceil(value.length / DEFAULT_CHARS_PER_TOKEN))
}

export function estimateRequestTokens(messages: ModelMessage[], tools?: ModelToolDefinition[]): number {
  const messageTokens = messages.reduce((sum, message) => {
    const calls = message.toolCalls?.reduce((callSum, call) => callSum + estimateTextTokens(call.name) + estimateTextTokens(call.arguments) + 8, 0) ?? 0
    return sum + estimateTextTokens(message.content) + estimateTextTokens(message.name ?? '') + calls + 6
  }, 0)
  const toolTokens = tools?.reduce((sum, tool) => sum + estimateTextTokens(JSON.stringify(tool)) + 12, 0) ?? 0
  return messageTokens + toolTokens + 32
}

/**
 * Keeps the most useful recent context inside an approximate token budget.
 * Tool schemas are included in the same budget because Groq counts them as
 * request input too. This is intentionally conservative for Free Tier use.
 */
export function compactMessagesForBudget(
  messages: ModelMessage[],
  maxTokens: number,
  tools?: ModelToolDefinition[]
): ModelMessage[] {
  if (!messages.length) return []
  const totalTokenLimit = Math.max(800, Math.trunc(maxTokens))
  const toolReserve = tools?.length ? Math.max(0, estimateRequestTokens([], tools) - 32) : 0
  const messageTokenLimit = Math.max(240, totalTokenLimit - toolReserve - 32)
  const charLimit = messageTokenLimit * DEFAULT_CHARS_PER_TOKEN
  let working = messages.map(cloneMessage)

  const totalEstimate = (candidate: ModelMessage[]): number => estimateRequestTokens(candidate, tools)
  const fits = (candidate: ModelMessage[]): boolean => totalEstimate(candidate) <= totalTokenLimit

  // Large terminal/file outputs are the first thing to compact. Recent results
  // stay useful, but do not get to consume the entire prompt budget.
  const maxToolChars = Math.max(600, Math.min(10_000, Math.floor(charLimit * 0.28)))
  working = working.map((message) => message.role === 'tool'
    ? { ...message, content: clipMiddle(message.content, maxToolChars, '\n… resultado anterior compactado pelo NIX …\n') }
    : message)

  const firstSystem = working.findIndex((message) => message.role === 'system')
  if (firstSystem >= 0) {
    const maxSystemChars = Math.max(700, Math.min(12_000, Math.floor(charLimit * 0.48)))
    working[firstSystem] = {
      ...working[firstSystem],
      content: clipMiddle(working[firstSystem].content, maxSystemChars, '\n… contexto-base compactado pelo NIX …\n')
    }
  }

  if (fits(working)) return working

  // Prefer the most recent coherent suffix. Never start a suffix at a tool
  // result or at an assistant tool-call message, which would break tool-call
  // protocol pairing.
  const baseIndexes = new Set(firstSystem >= 0 ? [firstSystem] : [])
  const base = firstSystem >= 0 ? [working[firstSystem]] : []
  const candidates: number[] = []
  for (let index = 0; index < working.length; index += 1) {
    if (baseIndexes.has(index)) continue
    const message = working[index]
    if (message.role === 'user' || message.role === 'system' || (message.role === 'assistant' && !message.toolCalls?.length)) {
      candidates.push(index)
    }
  }

  for (const start of candidates) {
    const suffix = working.slice(start).filter((_message, index) => !baseIndexes.has(start + index))
    const selected = [...base, ...suffix]
    if (fits(selected)) return selected
  }

  // Last-resort compaction: preserve the primary system instruction and the
  // newest message, then shrink their text until the complete request (tools
  // included) fits. This path is what protects the 8K TPM Free Tier window
  // when tool schemas themselves are relatively large.
  const tail = working.at(-1)
  if (!tail) return base
  let latestUserIndex = -1
  for (let index = working.length - 1; index >= 0; index -= 1) {
    if (working[index].role === 'user') { latestUserIndex = index; break }
  }
  const pinnedIndexes = [...new Set([firstSystem, latestUserIndex, working.length - 1].filter((index) => index >= 0))].sort((a, b) => a - b)
  let selected: ModelMessage[] = pinnedIndexes.map((index) => cloneMessage(working[index]))

  const minimumChars = (message: ModelMessage): number => message.role === 'system' ? 320 : 420
  for (let pass = 0; pass < 20 && !fits(selected); pass += 1) {
    const reducible = selected
      .map((message, index) => ({ index, length: message.content.length, minimum: minimumChars(message) }))
      .filter((entry) => entry.length > entry.minimum)
      .sort((left, right) => right.length - left.length)[0]
    if (!reducible) break

    const current = selected[reducible.index]
    const overflowTokens = Math.max(1, totalEstimate(selected) - totalTokenLimit)
    const shrinkChars = Math.max(160, overflowTokens * DEFAULT_CHARS_PER_TOKEN + 80)
    const nextSize = Math.max(reducible.minimum, current.content.length - shrinkChars)
    selected[reducible.index] = {
      ...current,
      content: clipMiddle(current.content, nextSize, '\n… compactado pelo NIX …\n')
    }
  }

  if (fits(selected)) return selected

  // If schemas alone nearly exhaust the configured budget there may be no way
  // to make the full request fit without dropping tools. Keep the latest user
  // context as small as possible; the caller/provider can then apply its final
  // quota guard instead of silently deleting tool capabilities.
  const newestUser = [...selected].reverse().find((message) => message.role === 'user')
  const newest = newestUser ?? selected.at(-1) ?? tail
  return [{ ...newest, content: clipMiddle(newest.content, 240, '\n…\n') }]
}

function cloneMessage(message: ModelMessage): ModelMessage {
  return {
    ...message,
    toolCalls: message.toolCalls?.map((call) => ({ ...call }))
  }
}

function clipMiddle(value: string, maxCharacters: number, marker: string): string {
  if (value.length <= maxCharacters) return value
  if (maxCharacters <= marker.length + 40) return value.slice(0, maxCharacters)
  const available = maxCharacters - marker.length
  const head = Math.ceil(available * 0.6)
  const tail = Math.floor(available * 0.4)
  return `${value.slice(0, head)}${marker}${value.slice(-tail)}`
}
