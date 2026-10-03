import { describe, expect, test } from 'vitest'

import { ContextBuilder } from './context-builder'

describe('ContextBuilder', () => {
  test('orders instructions, summary, project context, history and current request', () => {
    const messages = new ContextBuilder().build({
      systemPrompt: 'You are a coding agent.',
      workspaceRules: 'Run tests.',
      summary: 'Earlier decision.',
      projectMap: 'src/index.ts',
      history: [{ role: 'assistant', content: 'Earlier answer' }],
      attachedFiles: [{ path: 'src/index.ts', content: 'export {}' }],
      recentToolResults: [{ name: 'search_files', content: '1 match' }],
      userPrompt: 'Make the change',
      maxCharacters: 10_000
    })

    expect(messages.map((message) => message.role)).toEqual(['system', 'system', 'system', 'assistant', 'user', 'tool', 'user'])
    expect(messages.at(-1)?.content).toBe('Make the change')
  })

  test('excludes secret attachments', () => {
    const messages = new ContextBuilder().build({
      systemPrompt: 'Agent', userPrompt: 'Inspect', maxCharacters: 10_000,
      attachedFiles: [
        { path: '.env', content: 'GROQ_API_KEY=secret' },
        { path: 'keys/server.pem', content: 'private' },
        { path: 'src/app.ts', content: 'safe' }
      ]
    })

    const serialized = JSON.stringify(messages)
    expect(serialized).toContain('src/app.ts')
    expect(serialized).not.toContain('GROQ_API_KEY')
    expect(serialized).not.toContain('private')
  })

  test('compacts deterministically by dropping oldest history first', () => {
    const input = {
      systemPrompt: 'System', summary: 'Summary', userPrompt: 'Current request', maxCharacters: 90,
      history: [
        { role: 'user' as const, content: 'oldest-message-that-should-be-dropped' },
        { role: 'assistant' as const, content: 'newest-message-that-should-remain' }
      ]
    }

    const first = new ContextBuilder().build(input)
    const second = new ContextBuilder().build(input)

    expect(first).toEqual(second)
    expect(JSON.stringify(first)).not.toContain('oldest-message')
    expect(first.at(-1)?.content).toBe('Current request')
  })
})
