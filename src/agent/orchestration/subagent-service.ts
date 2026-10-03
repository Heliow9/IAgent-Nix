import type { NixSettings } from '../../shared/contracts'
import { compactMessagesForBudget } from '../context/context-budget'
import type { ModelMessage, ModelProvider, ReasoningEffort } from '../providers/model-provider'

export type SubagentRole = 'planner' | 'reviewer' | 'debugger' | 'tester' | 'architect'

export class SubagentService {
  constructor(
    private readonly provider: ModelProvider,
    private readonly model: string,
    private readonly getSettings?: () => NixSettings
  ) {}

  async run(role: SubagentRole, task: string, context: string, signal: AbortSignal): Promise<string> {
    let content = ''
    const settings = this.getSettings?.()
    const freeTier = settings?.groqFreeTierMode ?? false
    const contextBudget = freeTier ? Math.min(settings?.contextTokenBudget ?? 3_600, 2_400) : Math.min(settings?.contextTokenBudget ?? 12_000, 8_000)
    const messages: ModelMessage[] = compactMessagesForBudget([
      { role: 'system', content: rolePrompt(role, freeTier) },
      { role: 'user', content: `Tarefa:\n${task}\n\nContexto disponível:\n${context}` }
    ], contextBudget)
    for await (const event of this.provider.stream({
      model: this.model,
      messages,
      temperature: 0.1,
      reasoningEffort: settings?.reasoningMode && settings.reasoningMode !== 'auto' ? settings.reasoningMode : roleEffort(role),
      maxCompletionTokens: freeTier ? Math.min(settings?.maxCompletionTokens ?? 2_200, 1_400) : settings?.maxCompletionTokens,
      requestClass: 'subagent'
    }, signal)) if (event.type === 'text-delta') content += event.delta
    return content.trim().slice(0, 20_000)
  }
}

function roleEffort(role: SubagentRole): ReasoningEffort {
  return role === 'tester' ? 'medium' : 'high'
}

function rolePrompt(role: SubagentRole, freeTier: boolean): string {
  const common = 'Você é um subagente técnico do NIX. Responda em português do Brasil. Seja crítico, concreto e baseado apenas no contexto fornecido. Não alegue ter executado ações que não executou.'
  const quota = freeTier ? ' O Groq Free Tier está ativo: seja conciso e entregue uma única análise útil, sem repetir contexto.' : ''
  const details: Record<SubagentRole, string> = {
    planner: 'Crie um plano curto com dependências, arquivos prováveis, riscos e critérios de conclusão.',
    reviewer: 'Revise a abordagem procurando bugs, regressões, riscos de segurança, lacunas de teste e mudanças acidentais.',
    debugger: 'Analise causa raiz, evidências necessárias, hipóteses ordenadas e menor correção segura.',
    tester: 'Defina testes que provem o comportamento, incluindo regressões e casos de borda.',
    architect: 'Avalie arquitetura, limites de módulos, fluxo de dados, acoplamento e evolução incremental.'
  }
  return `${common}${quota}\n${details[role]}`
}
