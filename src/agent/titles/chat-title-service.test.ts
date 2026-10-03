import { describe, expect, test } from 'vitest'

import type { ModelProvider } from '../providers/model-provider'
import { ChatTitleService } from './chat-title-service'

describe('ChatTitleService', () => {
  test('normalizes a concise Portuguese title returned by the model', async () => {
    const provider: ModelProvider = {
      async *stream() { yield { type: 'text-delta', delta: '"Melhorias no cadastro de funcionários"' }; yield { type: 'completed' } }
    }

    const title = await new ChatTitleService(provider, 'fast-model').generate('Melhore o cadastro', 'Implementei os ajustes')

    expect(title).toBe('Melhorias no cadastro de funcionários')
  })

  test('falls back to the first message when title generation fails', async () => {
    const provider: ModelProvider = { async *stream() { throw new Error('offline') } }

    const title = await new ChatTitleService(provider, 'fast-model').generate('Adicionar autenticação com permissões detalhadas para usuários')

    expect(title).toBe('Adicionar autenticação com permissões detalhadas…')
  })
})
