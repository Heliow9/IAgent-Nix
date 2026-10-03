import { describe, expect, test } from 'vitest'

import type { NixSettings } from '../../shared/contracts'
import { GroqProvider, type GroqClientLike } from './groq-provider'

describe('GroqProvider', () => {
  test('can be constructed before the user configures a Groq key', () => {
    expect(() => new GroqProvider({ apiKey: '' })).not.toThrow()
  })

  test('streams text and assembles fragmented tool calls', async () => {
    const client = fakeClient([
      { choices: [{ delta: { content: 'Hello ' } }] },
      { choices: [{ delta: { content: 'world', tool_calls: [{ index: 0, id: 'call-1', function: { name: 'read_', arguments: '{"pa' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'file', arguments: 'th":"src/a.ts"}' } }] } }] }
    ])
    const provider = new GroqProvider({ client })

    const events = await collect(provider.stream({ model: 'openai/gpt-oss-120b', reasoningEffort: 'high', messages: [{ role: 'user', content: 'Read it' }] }, new AbortController().signal))

    expect(events).toEqual([
      { type: 'text-delta', delta: 'Hello ' },
      { type: 'text-delta', delta: 'world' },
      { type: 'tool-call', id: 'call-1', name: 'read_file', arguments: '{"path":"src/a.ts"}' },
      { type: 'completed' }
    ])
  })

  test('passes reasoning effort and completion budget to GPT-OSS', async () => {
    let receivedBody: Record<string, unknown> | undefined
    const client = fakeClient([], undefined, (body) => { receivedBody = body as Record<string, unknown> })
    const provider = new GroqProvider({ client, getSettings: () => settings({ groqFreeTierMode: false }) })

    await collect(provider.stream({
      model: 'openai/gpt-oss-120b', reasoningEffort: 'high', maxCompletionTokens: 3210,
      messages: [{ role: 'user', content: 'Debug this' }]
    }, new AbortController().signal))

    expect(receivedBody).toMatchObject({ reasoning_effort: 'high', max_completion_tokens: 3210, stream: true })
  })



  test('forwards tool_choice to Groq for forced workspace inspection', async () => {
    let receivedBody: Record<string, unknown> | undefined
    const client = fakeClient([], undefined, (body) => { receivedBody = body as Record<string, unknown> })
    const provider = new GroqProvider({ client, getSettings: () => settings({ groqFreeTierMode: false }) })

    await collect(provider.stream({
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: 'Inspect the workspace' }],
      tools: [{ type: 'function', function: { name: 'workspace_overview', description: 'Overview', parameters: { type: 'object', properties: {} } } }],
      toolChoice: { type: 'function', function: { name: 'workspace_overview' } }
    }, new AbortController().signal))

    expect(receivedBody?.tool_choice).toEqual({ type: 'function', function: { name: 'workspace_overview' } })
  })


  test('relaxes Groq-side tool constraints and keeps strict validation local to NIX', async () => {
    let receivedBody: Record<string, unknown> | undefined
    const client = fakeClient([], undefined, (body) => { receivedBody = body as Record<string, unknown> })
    const provider = new GroqProvider({ client, getSettings: () => settings({ groqFreeTierMode: false }) })

    await collect(provider.stream({
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: 'Search' }],
      tools: [{
        type: 'function',
        function: {
          name: 'search_files', description: 'Search',
          parameters: {
            type: 'object', additionalProperties: false, required: ['query'],
            properties: { query: { type: 'string', minLength: 1 }, maxResults: { type: 'integer', minimum: 1 } }
          }
        }
      }]
    }, new AbortController().signal))

    const tools = receivedBody?.tools as Array<{ function: { parameters: Record<string, unknown> } }>
    const parameters = tools[0].function.parameters
    const properties = parameters.properties as Record<string, Record<string, unknown>>
    expect(receivedBody).toMatchObject({ disable_tool_validation: true, reasoning_format: 'hidden' })
    expect(parameters.required).toBeUndefined()
    expect(parameters.additionalProperties).toBeUndefined()
    expect(properties.query.minLength).toBeUndefined()
    expect(properties.query.type).toBe('string')
    expect(properties.maxResults.minimum).toBeUndefined()
  })

  test('retries a Groq tool-validation failure with an open schema for only the offending tool', async () => {
    const bodies: Record<string, unknown>[] = []
    let attempt = 0
    const client: GroqClientLike = {
      chat: { completions: { create: async (body) => {
        bodies.push(body as Record<string, unknown>)
        attempt += 1
        if (attempt === 1) {
          throw Object.assign(new Error('tool call validation failed'), {
            status: 400,
            error: { message: 'Tool call validation failed: parameters for tool search_files did not match schema: errors: [/query: minLength: got 0, want 1]' }
          })
        }
        return { stream: (async function * () {})() }
      } } }
    }
    const provider = new GroqProvider({ client, getSettings: () => settings({ groqFreeTierMode: false }) })

    await collect(provider.stream({
      model: 'openai/gpt-oss-120b', messages: [{ role: 'user', content: 'Search' }],
      tools: [
        { type: 'function', function: { name: 'search_files', description: 'Search', parameters: { type: 'object', properties: { query: { type: 'string' } } } } },
        { type: 'function', function: { name: 'read_file', description: 'Read', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }
      ]
    }, new AbortController().signal))

    expect(bodies).toHaveLength(2)
    const retryTools = bodies[1].tools as Array<{ function: { name: string; parameters: Record<string, unknown> } }>
    expect(retryTools.find((tool) => tool.function.name === 'search_files')?.function.parameters).toEqual({ type: 'object', additionalProperties: true })
    expect(retryTools.find((tool) => tool.function.name === 'read_file')?.function.parameters).not.toEqual({ type: 'object', additionalProperties: true })
  })

  test('normalizes the legacy 120 model id', async () => {
    let receivedBody: Record<string, unknown> | undefined
    const client = fakeClient([], undefined, (body) => { receivedBody = body as Record<string, unknown> })
    const provider = new GroqProvider({ client })

    await collect(provider.stream({ model: 'openai/gpt-oss-120', messages: [{ role: 'user', content: 'Hi' }] }, new AbortController().signal))

    expect(receivedBody?.model).toBe('openai/gpt-oss-120b')
  })

  test('captures Groq rate-limit headers for the UI', async () => {
    const headers = new Map([
      ['x-ratelimit-limit-requests', '1000'], ['x-ratelimit-remaining-requests', '998'],
      ['x-ratelimit-limit-tokens', '8000'], ['x-ratelimit-remaining-tokens', '6500'],
      ['x-ratelimit-reset-tokens', '7.5s']
    ])
    const provider = new GroqProvider({ client: fakeClient([], undefined, undefined, { get: (name) => headers.get(name.toLowerCase()) ?? null }) })

    await collect(provider.stream({ model: 'openai/gpt-oss-120b', messages: [{ role: 'user', content: 'Hi' }] }, new AbortController().signal))

    expect(provider.getQuotaSnapshot().server).toEqual(expect.objectContaining({
      requestsPerDay: expect.objectContaining({ limit: 1000, remaining: 998 }),
      tokensPerMinute: expect.objectContaining({ limit: 8000, remaining: 6500, reset: '7.5s' })
    }))
  })

  test('passes the abort signal to the Groq request', async () => {
    let receivedSignal: AbortSignal | undefined
    const client = fakeClient([], (signal) => { receivedSignal = signal })
    const provider = new GroqProvider({ client })
    const controller = new AbortController()

    await collect(provider.stream({ model: 'model-a', messages: [{ role: 'user', content: 'Stop' }] }, controller.signal))

    expect(receivedSignal).toBe(controller.signal)
  })

  test('maps internal assistant tool calls to the Groq message shape', async () => {
    let receivedBody: unknown
    const client: GroqClientLike = {
      chat: { completions: { create: async (body) => {
        receivedBody = body
        return { stream: (async function * () {})() }
      } } }
    }
    const provider = new GroqProvider({ client })

    await collect(provider.stream({
      model: 'model-a',
      messages: [{
        role: 'assistant', content: '',
        toolCalls: [{ id: 'call-1', name: 'read_file', arguments: '{"path":"a.ts"}' }]
      }]
    }, new AbortController().signal))

    expect(receivedBody).toMatchObject({
      messages: [{
        role: 'assistant',
        tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }]
      }]
    })
  })

  test('surfaces sanitized Groq 400 details instead of a generic provider error', async () => {
    const client: GroqClientLike = {
      chat: { completions: { create: async () => {
        throw Object.assign(new Error('Bad request gsk_secret_should_not_leak'), {
          status: 400,
          error: { message: 'Invalid tool call generated', failed_generation: { reason: 'Tool call arguments are not valid JSON' } }
        })
      } } }
    }
    const provider = new GroqProvider({ client })

    await expect(collect(provider.stream({ model: 'openai/gpt-oss-120b', messages: [{ role: 'user', content: 'Inspect' }] }, new AbortController().signal)))
      .rejects.toEqual(expect.objectContaining({ code: 'PROVIDER_ERROR', message: expect.stringContaining('Tool call arguments are not valid JSON') }))
  })

  test('normalizes authentication errors without including credentials', async () => {
    const client: GroqClientLike = {
      chat: { completions: { create: async () => { throw Object.assign(new Error('Invalid API key sk-secret'), { status: 401 }) } } }
    }
    const provider = new GroqProvider({ client })

    await expect(collect(provider.stream({ model: 'model-a', messages: [] }, new AbortController().signal)))
      .rejects.toEqual(expect.objectContaining({ code: 'AUTHENTICATION_ERROR', message: 'Groq authentication failed' }))
  })
})

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = []
  for await (const event of stream) output.push(event)
  return output
}

function fakeClient(
  chunks: unknown[], captureSignal?: (signal: AbortSignal | undefined) => void,
  captureBody?: (body: unknown) => void, headers?: { get(name: string): string | null }
): GroqClientLike {
  return {
    chat: {
      completions: {
        create: async (body, options) => {
          captureSignal?.(options?.signal)
          captureBody?.(body)
          return { headers, stream: (async function * () { for (const chunk of chunks) yield chunk })() }
        }
      }
    }
  }
}

function settings(patch: Partial<NixSettings> = {}): NixSettings {
  return {
    fastModel: 'openai/gpt-oss-120b', deepModel: 'openai/gpt-oss-120b', contextMaxCharacters: 140_000,
    contextTokenBudget: 3_600, maxCompletionTokens: 2_200, maxConcurrentRuns: 1, autoVerify: true,
    skillMode: 'auto', superpowersEnabled: true, modelRouting: 'auto', reasoningMode: 'auto',
    groqFreeTierMode: true, quotaProtection: 'adaptive', groqDailyTokenLimit: 200_000, ...patch
  }
}
