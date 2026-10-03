export type ModelRole = 'system' | 'user' | 'assistant' | 'tool'
export type ReasoningEffort = 'low' | 'medium' | 'high'
export type ModelToolChoice = 'auto' | 'required' | 'none' | { type: 'function'; function: { name: string } }

export interface ModelMessage {
  role: ModelRole
  content: string
  toolCallId?: string
  name?: string
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
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
  toolChoice?: ModelToolChoice
  temperature?: number
  responseFormat?: 'json_object'
  reasoningEffort?: ReasoningEffort
  maxCompletionTokens?: number
  requestClass?: 'agent' | 'router' | 'title' | 'subagent'
}

export type ModelEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-call'; id: string; name: string; arguments: string }
  | { type: 'completed' }

export interface ModelProvider {
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>
}
