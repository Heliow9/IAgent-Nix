import { describe, expect, test } from 'vitest'

import type { ModelMessage } from '../providers/model-provider'
import { resolveConversationFollowUp } from './follow-up-context'

describe('resolveConversationFollowUp', () => {
  const history: ModelMessage[] = [
    { role: 'user', content: 'Quais melhorias de UX podem ser aplicadas nas telas do dashboard PWA?' },
    { role: 'assistant', content: 'Sugeri melhorias de navegação, feedback e acessibilidade.' }
  ]

  test('preserves the previous objective for a short domain follow-up', () => {
    const result = resolveConversationFollowUp('E na API?', history)

    expect(result.previousUserPrompt).toContain('melhorias de UX')
    expect(result.operationalPrompt).toContain('Objetivo anterior do usuário')
    expect(result.operationalPrompt).toContain('E na API?')
    expect(result.contextNote).toContain('follow-up elíptico')
    expect(result.contextNote).toContain('novo foco é "api"')
    expect(result.groundingPrompt).toBe('E na API?')
  })

  test('does not rewrite a complete standalone request', () => {
    const prompt = 'Analise a API e identifique gargalos de performance nas rotas.'
    expect(resolveConversationFollowUp(prompt, history)).toEqual({ operationalPrompt: prompt, groundingPrompt: prompt })
  })

  test('does not invent context when there is no previous user message', () => {
    expect(resolveConversationFollowUp('E na API?', [])).toEqual({ operationalPrompt: 'E na API?', groundingPrompt: 'E na API?' })
  })
})
