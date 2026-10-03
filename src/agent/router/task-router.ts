import { z } from 'zod'

import type { ModelProvider } from '../providers/model-provider'

const routeSchema = z.object({
  route: z.enum(['fast', 'deep']),
  reason: z.string().min(1),
  requiredTools: z.array(z.string())
})

export type TaskRoute = z.infer<typeof routeSchema>

export class TaskRouter {
  constructor(private readonly provider: ModelProvider, private readonly fastModel: string) {}

  async route(input: string, signal: AbortSignal = new AbortController().signal): Promise<TaskRoute> {
    let content = ''
    try {
      for await (const event of this.provider.stream({
        model: this.fastModel,
        temperature: 0,
        responseFormat: 'json_object',
        messages: [
          { role: 'system', content: 'Classify coding tasks. Return JSON with route fast|deep, a short reason, and requiredTools as an array of tool names.' },
          { role: 'user', content: input }
        ]
      }, signal)) {
        if (event.type === 'text-delta') content += event.delta
      }
      return routeSchema.parse(JSON.parse(content))
    } catch (error) {
      if (signal.aborted) throw error
      return { route: 'deep', reason: 'Router response was invalid', requiredTools: [] }
    }
  }
}
