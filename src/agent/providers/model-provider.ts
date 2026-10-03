export type ModelRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ModelMessage {
  role: ModelRole
  content: string
  toolCallId?: string
  name?: string
}

export interface ModelToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ModelRequest {
  model: string
  messages: ModelMessage[]
  tools?: ModelToolDefinition[]
  temperature?: number
  responseFormat?: 'json_object'
}

export type ModelEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-call'; id: string; name: string; arguments: string }
  | { type: 'completed' }

export interface ModelProvider {
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>
}
