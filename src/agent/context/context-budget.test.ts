import { describe, expect, test } from 'vitest'

import type { ModelMessage, ModelToolDefinition } from '../providers/model-provider'
import { compactMessagesForBudget, estimateRequestTokens } from './context-budget'

describe('context budget', () => {
  test('keeps recent tool exchange while dropping old history', () => {
    const messages: ModelMessage[] = [
      { role: 'system', content: 'base rules' },
      { role: 'user', content: 'old '.repeat(2000) },
      { role: 'assistant', content: 'old answer '.repeat(1000) },
      { role: 'user', content: 'current task' },
      { role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'read_file', arguments: '{"path":"a.ts"}' }] },
      { role: 'tool', toolCallId: '1', name: 'read_file', content: 'important result' }
    ]
    const compacted = compactMessagesForBudget(messages, 1000)
    expect(compacted.some((message) => message.content === 'current task')).toBe(true)
    expect(compacted.some((message) => message.content === 'important result')).toBe(true)
    expect(estimateRequestTokens(compacted)).toBeLessThanOrEqual(1000)
  })

  test('clips a single huge tool result instead of exceeding the request budget', () => {
    const messages: ModelMessage[] = [
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'inspect' },
      { role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'read_file', arguments: '{}' }] },
      { role: 'tool', toolCallId: '1', name: 'read_file', content: 'x'.repeat(100_000) }
    ]
    const compacted = compactMessagesForBudget(messages, 1200)
    expect(compacted.at(-1)?.content.length).toBeLessThan(20_000)
    expect(estimateRequestTokens(compacted)).toBeLessThanOrEqual(1200)
  })

  test('never drops the current user request when local grounding is appended after it', () => {
    const messages: ModelMessage[] = [
      { role: 'system', content: 'base '.repeat(1200) },
      { role: 'user', content: 'Avalia todo esse projeto e a tela de login' },
      { role: 'system', content: 'workspace evidence '.repeat(1800) }
    ]
    const compacted = compactMessagesForBudget(messages, 900)

    expect(compacted.some((message) => message.role === 'user' && message.content.includes('tela de login'))).toBe(true)
  })

  test('reserves space for tool schemas inside the same input budget', () => {
    const messages: ModelMessage[] = [
      { role: 'system', content: 's'.repeat(4_000) },
      { role: 'user', content: 'u'.repeat(4_000) }
    ]
    const tools: ModelToolDefinition[] = [{
      type: 'function',
      function: {
        name: 'large_tool',
        description: 'd'.repeat(2_000),
        parameters: { type: 'object', properties: { query: { type: 'string', description: 'q'.repeat(1_000) } } }
      }
    }]
    const compacted = compactMessagesForBudget(messages, 1_800, tools)
    expect(estimateRequestTokens(compacted, tools)).toBeLessThanOrEqual(1_900)
  })
})
