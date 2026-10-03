import { describe, expect, test } from 'vitest'

import { GroqProvider, type GroqClientLike } from './groq-provider'

describe('GroqProvider', () => {
  test('streams text and assembles fragmented tool calls', async () => {
    const client = fakeClient([
      { choices: [{ delta: { content: 'Hello ' } }] },
      { choices: [{ delta: { content: 'world', tool_calls: [{ index: 0, id: 'call-1', function: { name: 'read_', arguments: '{"pa' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'file', arguments: 'th":"src/a.ts"}' } }] } }] }
    ])
    const provider = new GroqProvider({ client })

    const events = await collect(provider.stream({ model: 'model-a', messages: [{ role: 'user', content: 'Read it' }] }, new AbortController().signal))

    expect(events).toEqual([
      { type: 'text-delta', delta: 'Hello ' },
      { type: 'text-delta', delta: 'world' },
      { type: 'tool-call', id: 'call-1', name: 'read_file', arguments: '{"path":"src/a.ts"}' },
      { type: 'completed' }
    ])
  })

  test('passes the abort signal to the Groq request', async () => {
    let receivedSignal: AbortSignal | undefined
    const client = fakeClient([], (signal) => { receivedSignal = signal })
    const provider = new GroqProvider({ client })
    const controller = new AbortController()

    await collect(provider.stream({ model: 'model-a', messages: [{ role: 'user', content: 'Stop' }] }, controller.signal))

    expect(receivedSignal).toBe(controller.signal)
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

function fakeClient(chunks: unknown[], captureSignal?: (signal: AbortSignal | undefined) => void): GroqClientLike {
  return {
    chat: {
      completions: {
        create: async (_body, options) => {
          captureSignal?.(options?.signal)
          return (async function * () {
            for (const chunk of chunks) yield chunk
          })()
        }
      }
    }
  }
}
