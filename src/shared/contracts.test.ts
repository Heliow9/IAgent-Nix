import { describe, expect, test } from 'vitest'

import {
  agentEventSchema,
  chatRecordSchema,
  permissionModeSchema,
  workspaceRecordSchema,
  workspaceEntrySchema
} from './contracts'

describe('shared contracts', () => {
  test('rejects_invalid_permission_mode', () => {
    expect(permissionModeSchema.safeParse('unrestricted').success).toBe(false)
  })

  test('accepts_workspace_entry', () => {
    const result = workspaceEntrySchema.safeParse({
      name: 'src',
      path: 'src',
      kind: 'directory'
    })

    expect(result.success).toBe(true)
  })

  test('agent_event_requires_known_discriminator', () => {
    const result = agentEventSchema.safeParse({
      type: 'agent.did_something_unknown',
      runId: 'run-1',
      timestamp: '2026-10-03T12:00:00.000Z'
    })

    expect(result.success).toBe(false)
  })

  test('accepts cloud-ready workspace and chat records', () => {
    const workspace = workspaceRecordSchema.parse({
      id: '5eaf1f7c-a51f-4bd2-9184-90fa632d915d', name: 'Meu projeto', localRootPath: 'C:/work',
      createdAt: '2026-10-03T12:00:00.000Z', updatedAt: '2026-10-03T12:00:00.000Z',
      lastOpenedAt: '2026-10-03T12:00:00.000Z', revision: 1
    })
    const chat = chatRecordSchema.parse({
      id: '76064aa1-205c-41c8-b0fb-a5df92f669be', workspaceId: workspace.id, title: 'Cadastro de funcionários',
      titleSource: 'generated', status: 'active', summary: '', createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt, revision: 1
    })

    expect(workspace.localRootPath).toBe('C:/work')
    expect(chat.titleSource).toBe('generated')
  })

  test('accepts queued run events with a persistent position', () => {
    expect(agentEventSchema.parse({
      type: 'run.queued', runId: 'run-1', timestamp: '2026-10-03T12:00:00.000Z', queuePosition: 2
    })).toMatchObject({ queuePosition: 2 })
  })
})
