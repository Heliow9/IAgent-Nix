import { describe, expect, test } from 'vitest'

import type { ModelEvent, ModelProvider } from '../providers/model-provider'
import { TaskRouter } from './task-router'

describe('TaskRouter', () => {
  test('returns validated routing JSON from the fast model', async () => {
    const router = new TaskRouter(providerWithText('{"route":"fast","reason":"small question","requiredTools":[]}'), 'fast-model')

    await expect(router.route('What is TypeScript?')).resolves.toEqual({
      route: 'fast', reason: 'small question', requiredTools: []
    })
  })

  test('falls back to deep routing when model JSON is malformed', async () => {
    const router = new TaskRouter(providerWithText('not-json'), 'fast-model')

    await expect(router.route('Refactor the app')).resolves.toEqual({
      route: 'deep', reason: 'Router response was invalid', requiredTools: []
    })
  })
})

function providerWithText(text: string): ModelProvider {
  return {
    async * stream(): AsyncIterable<ModelEvent> {
      yield { type: 'text-delta', delta: text }
      yield { type: 'completed' }
    }
  }
}
