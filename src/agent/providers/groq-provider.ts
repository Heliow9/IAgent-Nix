import Groq from 'groq-sdk'

import type { ModelEvent, ModelProvider, ModelRequest } from './model-provider'

interface GroqDeltaToolCall {
  index: number
  id?: string
  function?: { name?: string; arguments?: string }
}

interface GroqStreamChunk {
  choices?: Array<{ delta?: { content?: string | null; tool_calls?: GroqDeltaToolCall[] } }>
}

export interface GroqClientLike {
  chat: {
    completions: {
      create(body: unknown, options?: { signal?: AbortSignal }): Promise<AsyncIterable<unknown>>
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

export class GroqProvider implements ModelProvider {
  private readonly client: GroqClientLike

  constructor(options: { client?: GroqClientLike; apiKey?: string } = {}) {
    this.client = options.client ?? createClient(options.apiKey)
  }

  async * stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    try {
      const chunks = await this.client.chat.completions.create({
        model: request.model,
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
        tools: request.tools,
        temperature: request.temperature,
        response_format: request.responseFormat ? { type: request.responseFormat } : undefined,
        stream: true
      }, { signal })
      const calls = new Map<number, { id: string; name: string; arguments: string }>()
      for await (const rawChunk of chunks) {
        if (signal.aborted) throw abortError()
        const chunk = rawChunk as GroqStreamChunk
        const delta = chunk.choices?.[0]?.delta
        if (delta?.content) yield { type: 'text-delta', delta: delta.content }
        for (const partial of delta?.tool_calls ?? []) {
          const current = calls.get(partial.index) ?? { id: '', name: '', arguments: '' }
          current.id += partial.id ?? ''
          current.name += partial.function?.name ?? ''
          current.arguments += partial.function?.arguments ?? ''
          calls.set(partial.index, current)
        }
      }
      for (const call of [...calls.entries()].sort(([left], [right]) => left - right).map(([, value]) => value)) {
        yield { type: 'tool-call', ...call }
      }
      yield { type: 'completed' }
    } catch (error) {
      throw normalizeError(error)
    }
  }
}

function createClient(apiKey?: string): GroqClientLike {
  const groq = new Groq({ apiKey: apiKey ?? process.env.GROQ_API_KEY })
  return {
    chat: {
      completions: {
        create: async (body, options) => groq.chat.completions.create(
          body as Parameters<typeof groq.chat.completions.create>[0] & { stream: true },
          { signal: options?.signal }
        ) as unknown as AsyncIterable<unknown>
      }
    }
  }
}

function normalizeError(error: unknown): ModelProviderError {
  if (error instanceof ModelProviderError) return error
  if (error instanceof Error && (error.name === 'AbortError' || ('code' in error && error.code === 'ABORT_ERR'))) {
    return new ModelProviderError('CANCELLED', 'Groq request was cancelled')
  }
  const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : undefined
  if (status === 401 || status === 403) return new ModelProviderError('AUTHENTICATION_ERROR', 'Groq authentication failed')
  if (status === 429) return new ModelProviderError('RATE_LIMITED', 'Groq rate limit reached')
  return new ModelProviderError('PROVIDER_ERROR', 'Groq request failed')
}

function abortError(): Error {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}
