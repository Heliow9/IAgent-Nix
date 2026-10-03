import { describe, expect, test } from 'vitest'

import type { ModelEvent, ModelProvider, ModelRequest } from '../providers/model-provider'
import { TaskRouter, selectReasoningEffort } from './task-router'

describe('TaskRouter', () => {
  test('returns validated routing JSON from the fast model using low reasoning', async () => {
    const requests: ModelRequest[] = []
    const router = new TaskRouter(providerWithText('{"route":"fast","reasoning":"low","reason":"small question","requiredTools":[]}', requests), 'fast-model')

    await expect(router.route('What is TypeScript?')).resolves.toEqual({
      route: 'fast', reasoning: 'low', reason: 'small question', requiredTools: []
    })
    expect(requests[0]).toMatchObject({ reasoningEffort: 'low', maxCompletionTokens: 300, requestClass: 'router' })
  })

  test('falls back to deep/high routing when model JSON is malformed', async () => {
    const router = new TaskRouter(providerWithText('not-json'), 'fast-model')

    await expect(router.route('Refactor the app')).resolves.toEqual({
      route: 'deep', reasoning: 'high', reason: 'Router response was invalid', requiredTools: []
    })
  })

  test('routes locally without spending an extra Groq request in Free Tier mode', () => {
    const router = new TaskRouter(providerWithText(''), 'fast-model')
    expect(router.routeLocal('Explique o que esse arquivo faz').reasoning).toBe('low')
    expect(router.routeLocal('Corrija este componente React e adicione testes').reasoning).toBe('medium')
    expect(router.routeLocal('Faça debugging da integração backend e frontend e encontre a causa raiz').reasoning).toBe('high')
  })

  test('manual reasoning overrides automatic routing', () => {
    expect(selectReasoningEffort('high', { route: 'fast', reasoning: 'low', reason: 'x', requiredTools: [] })).toBe('high')
  })
})

function providerWithText(text: string, requests: ModelRequest[] = []): ModelProvider {
  return {
    async * stream(request): AsyncIterable<ModelEvent> {
      requests.push(request)
      yield { type: 'text-delta', delta: text }
      yield { type: 'completed' }
    }
  }
}
