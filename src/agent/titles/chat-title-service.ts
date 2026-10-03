import type { NixSettings } from '../../shared/contracts'
import type { ModelProvider } from '../providers/model-provider'

export class ChatTitleService {
  constructor(
    private readonly provider: ModelProvider,
    private readonly model: string,
    private readonly getSettings?: () => NixSettings
  ) {}

  async generate(firstMessage: string, firstAnswer = '', signal = new AbortController().signal): Promise<string> {
    // On Groq Free Tier, an extra model call just to name a chat wastes RPD/TPM.
    // A deterministic local title is good enough and keeps the quota for coding.
    if (this.getSettings?.().groqFreeTierMode) return fallbackTitle(firstMessage)
    try {
      let output = ''
      for await (const event of this.provider.stream({
        model: this.model,
        temperature: 0.2,
        reasoningEffort: 'low',
        maxCompletionTokens: 80,
        requestClass: 'title',
        messages: [
          { role: 'system', content: 'Crie somente um título curto, específico e em português do Brasil para esta conversa. Use no máximo 52 caracteres. Não use aspas, markdown ou ponto final.' },
          { role: 'user', content: `Pedido: ${firstMessage}\nResposta: ${firstAnswer}` }
        ]
      }, signal)) if (event.type === 'text-delta') output += event.delta
      const normalized = normalizeTitle(output)
      return normalized || fallbackTitle(firstMessage)
    } catch {
      return fallbackTitle(firstMessage)
    }
  }
}

function normalizeTitle(value: string): string {
  const title = value.replace(/^[\s"'`#*-]+|[\s"'`.]+$/g, '').replace(/\s+/g, ' ').trim()
  return title.length > 52 ? `${title.slice(0, 49).trimEnd()}…` : title
}

function fallbackTitle(value: string): string {
  const title = value.replace(/\s+/g, ' ').trim()
  return title.length > 52 ? `${title.slice(0, 49).trimEnd()}…` : title || 'Novo chat'
}
