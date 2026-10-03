import type { ModelMessage } from '../providers/model-provider'

export interface FollowUpResolution {
  operationalPrompt: string
  groundingPrompt: string
  contextNote?: string
  previousUserPrompt?: string
}

/**
 * Resolves short conversational follow-ups without spending another model call.
 * The user's literal message remains the final chat message; operationalPrompt is
 * only used for routing/tool selection and the context note tells the model how
 * to preserve the previous intent.
 */
export function resolveConversationFollowUp(currentPrompt: string, history: ModelMessage[]): FollowUpResolution {
  const previousUserPrompt = [...history].reverse().find((message) => message.role === 'user' && message.content.trim())?.content.trim()
  if (!previousUserPrompt || !isLikelyEllipticalFollowUp(currentPrompt)) {
    return { operationalPrompt: currentPrompt, groundingPrompt: currentPrompt }
  }

  const focus = extractFollowUpFocus(currentPrompt)
  const operationalPrompt = [
    'Continuação contextual da conversa.',
    `Objetivo anterior do usuário: ${previousUserPrompt}`,
    `Pergunta atual: ${currentPrompt}`,
    focus ? `Novo foco indicado agora: ${focus}.` : '',
    'Preserve a operação conversacional da pergunta anterior (por exemplo: analisar, recomendar melhorias, comparar ou diagnosticar), mas adapte critérios específicos ao novo domínio. Se um critério anterior só fizer sentido no foco antigo (por exemplo, UX de uma interface) e o novo foco for API, traduza a análise para qualidades adequadas da API, como desempenho, confiabilidade, segurança, contratos e manutenção. Não interprete a pergunta atual como uma busca isolada por palavra-chave.'
  ].filter(Boolean).join('\n')

  const contextNote = [
    'CONTINUIDADE DE CONVERSA:',
    `A mensagem atual (${JSON.stringify(currentPrompt)}) é um follow-up elíptico da pergunta anterior (${JSON.stringify(previousUserPrompt)}).`,
    focus ? `O novo foco é ${JSON.stringify(focus)}.` : '',
    'Mantenha a intenção/ação anterior, mas adapte os critérios ao domínio novo quando necessário. Não responda listando todos os arquivos/símbolos que contenham a palavra do novo foco; investigue somente o necessário para responder à continuação.'
  ].filter(Boolean).join(' ')

  // Grounding should prioritize the *new* focus. Reusing the entire previous
  // question here would make local keyword search repeat the old target (for
  // example dashboard/PWA when the user just asked "E na API?").
  return { operationalPrompt, groundingPrompt: currentPrompt, contextNote, previousUserPrompt }
}

function isLikelyEllipticalFollowUp(value: string): boolean {
  const text = normalize(value).trim()
  const words = text.match(/[a-z0-9_@./-]+/gu) ?? []
  if (!text || words.length > 18 || text.length > 140) return false

  const startsAsContinuation = /^(?:e\b|e\s+(?:na|no|nas|nos|sobre|quanto)\b|tambem\b|e\s+tambem\b|quanto\s+a\b|sobre\b|ness[ae]\b|nesses?\b|nisso\b|nele\b|nela\b)/u.test(text)
  const domainOnly = /\b(api|mobile|dashboard|frontend|backend|pwa|login|worker|connector|banco|database|db|ux|ui|web|desktop|servidor)\b/u.test(text)
  const explicitAction = /\b(avali\w*|revis\w*|analis\w*|verific\w*|corrig\w*|implement\w*|adicion\w*|alter\w*|melhor\w*|suger\w*|explic\w*|mostr\w*|list\w*|execut\w*|test\w*)\b/u.test(text)
  return startsAsContinuation || (domainOnly && !explicitAction && words.length <= 8)
}

function extractFollowUpFocus(value: string): string | undefined {
  const text = normalize(value)
  const match = text.match(/\b(api|mobile|dashboard|frontend|backend|pwa|login|worker|connector|banco|database|db|ux|ui|web|desktop|servidor)\b/u)
  return match?.[1]
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}
