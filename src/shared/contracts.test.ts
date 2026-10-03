import { describe, expect, test } from 'vitest'

import {
  agentEventSchema,
  permissionModeSchema,
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
})
