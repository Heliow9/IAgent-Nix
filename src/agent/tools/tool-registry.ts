import type { z } from 'zod'

import type { ModelToolDefinition } from '../providers/model-provider'

export type ToolEffect = 'read' | 'write' | 'delete' | 'command'
export type ToolPhase = 'workspace'

export interface ToolContext {
  runId: string
  signal: AbortSignal
}

export interface ToolDefinition<T = unknown> {
  name: string
  description: string
  parameters: Record<string, unknown>
  schema: z.ZodType<T>
  phase: ToolPhase
  effect: ToolEffect
}

type ToolHandler<T = unknown> = (args: T, context: ToolContext) => unknown | Promise<unknown>

interface RegisteredTool {
  definition: ToolDefinition<unknown>
  handler: ToolHandler<unknown>
}

export class ToolRegistryError extends Error {
  constructor(public readonly code: 'UNKNOWN_TOOL' | 'INVALID_ARGUMENTS', message: string) {
    super(message)
    this.name = 'ToolRegistryError'
  }
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>()

  register<T>(definition: ToolDefinition<T>, handler: ToolHandler<T>): void {
    this.tools.set(definition.name, {
      definition: definition as ToolDefinition<unknown>,
      handler: handler as ToolHandler<unknown>
    })
  }

  definitionsForPhase(phase: ToolPhase): ModelToolDefinition[] {
    return [...this.tools.values()]
      .filter((tool) => tool.definition.phase === phase)
      .map((tool) => ({
        type: 'function',
        function: {
          name: tool.definition.name,
          description: tool.definition.description,
          parameters: tool.definition.parameters
        }
      }))
  }

  effect(name: string): ToolEffect {
    const tool = this.tools.get(name)
    if (!tool) throw new ToolRegistryError('UNKNOWN_TOOL', `Unknown tool: ${name}`)
    return tool.definition.effect
  }

  parse(name: string, rawArguments: string): unknown {
    const tool = this.tools.get(name)
    if (!tool) throw new ToolRegistryError('UNKNOWN_TOOL', `Unknown tool: ${name}`)
    let parsed: unknown
    try {
      parsed = JSON.parse(rawArguments || '{}')
    } catch {
      throw new ToolRegistryError('INVALID_ARGUMENTS', `Arguments for ${name} are not valid JSON`)
    }
    const validation = tool.definition.schema.safeParse(parsed)
    if (!validation.success) throw new ToolRegistryError('INVALID_ARGUMENTS', validation.error.message)
    return validation.data
  }

  async execute(name: string, args: unknown, context: ToolContext): Promise<unknown> {
    const tool = this.tools.get(name)
    if (!tool) throw new ToolRegistryError('UNKNOWN_TOOL', `Unknown tool: ${name}`)
    const validation = tool.definition.schema.safeParse(args)
    if (!validation.success) throw new ToolRegistryError('INVALID_ARGUMENTS', validation.error.message)
    return tool.handler(validation.data, context)
  }
}
