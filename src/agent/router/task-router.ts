import { z } from 'zod'

import type { ModelProvider, ReasoningEffort } from '../providers/model-provider'

const routeSchema = z.object({
  route: z.enum(['fast', 'deep']),
  reasoning: z.enum(['low', 'medium', 'high']),
  reason: z.string().min(1),
  requiredTools: z.array(z.string())
})

export type TaskRoute = z.infer<typeof routeSchema>

export class TaskRouter {
  constructor(private readonly provider: ModelProvider, private readonly fastModel: string) {}

  routeLocal(input: string): TaskRoute {
    const text = input.toLowerCase()
    const complexPatterns = [
      /\b(debug|depur|causa raiz|race condition|deadlock|memory leak|vazamento)\b/,
      /\b(arquitet|refator|migra|integra|seguran|autopilot|subagente|orquestr)\b/,
      /\b(banco|database|prisma|mysql|postgres|api|backend|frontend)\b.*\b(e|\+|com)\b/,
      /\b(implemente tudo|implementar tudo|completo|completamente|produção|production)\b/,
      /\b(testes? integr|e2e|regress|build falha|typecheck|compila)\b/
    ]
    if (complexPatterns.some((pattern) => pattern.test(text)) || input.length > 900) {
      return { route: 'deep', reasoning: 'high', reason: 'Tarefa localmente classificada como complexa', requiredTools: [] }
    }

    if (input.length <= 180 && /\b(explique|o que|onde|abra|mostre|localize|encontre)\b/.test(text)) {
      return { route: 'fast', reasoning: 'low', reason: 'Consulta curta de leitura ou navegação', requiredTools: [] }
    }

    const mediumPatterns = [
      /\b(corrig\w*|corrij\w*|ajust\w*|implement\w*|adicion\w*|cri\w*|alter\w*|modific\w*|melhor\w*|otimiz\w*|test\w*|código|codigo)\b/u,
      /```|\.(ts|tsx|js|jsx|py|go|rs|java|cs|json|yaml|yml)\b/
    ]
    if (mediumPatterns.some((pattern) => pattern.test(text)) || input.length > 220) {
      return { route: 'deep', reasoning: 'medium', reason: 'Tarefa de implementação ou análise moderada', requiredTools: [] }
    }

    return { route: 'fast', reasoning: 'low', reason: 'Pergunta ou ação curta', requiredTools: [] }
  }

  async route(input: string, signal: AbortSignal = new AbortController().signal): Promise<TaskRoute> {
    let content = ''
    try {
      for await (const event of this.provider.stream({
        model: this.fastModel,
        temperature: 0,
        responseFormat: 'json_object',
        reasoningEffort: 'low',
        maxCompletionTokens: 300,
        requestClass: 'router',
        messages: [
          {
            role: 'system',
            content: 'Classifique tarefas de programação. Retorne JSON com route fast|deep, reasoning low|medium|high, reason curto e requiredTools como array. Use high apenas para debugging difícil, arquitetura, refatorações grandes, integrações amplas ou tarefas multi-etapas; medium para implementação normal; low para perguntas/localizações/ações simples.'
          },
          { role: 'user', content: input }
        ]
      }, signal)) {
        if (event.type === 'text-delta') content += event.delta
      }
      return routeSchema.parse(JSON.parse(content))
    } catch (error) {
      if (signal.aborted) throw error
      return { route: 'deep', reasoning: 'high', reason: 'Router response was invalid', requiredTools: [] }
    }
  }
}

export function selectReasoningEffort(mode: 'auto' | ReasoningEffort, route?: TaskRoute): ReasoningEffort {
  if (mode !== 'auto') return mode
  return route?.reasoning ?? (route?.route === 'fast' ? 'low' : 'medium')
}
