import { describe, expect, test } from 'vitest'

import { ApprovalPolicy } from './approval-policy'

describe('ApprovalPolicy', () => {
  const policy = new ApprovalPolicy()

  test('default ask mode requires approval for writes and commands but not reads', () => {
    expect(policy.evaluate('read_file', {}, 'ask').required).toBe(false)
    expect(policy.evaluate('propose_file_change', { path: 'src/a.ts' }, 'ask').required).toBe(true)
    expect(policy.evaluate('run_command', { program: 'git', args: ['status'] }, 'ask').required).toBe(true)
  })

  test('auto-workspace permits writes but keeps risky commands behind approval', () => {
    expect(policy.evaluate('propose_file_change', { path: 'src/a.ts' }, 'auto-workspace').required).toBe(false)
    expect(policy.evaluate('run_command', { program: 'git', args: ['status'] }, 'auto-workspace').required).toBe(false)
    expect(policy.evaluate('run_command', { program: 'npm', args: ['install', 'left-pad'] }, 'auto-workspace').required).toBe(true)
    expect(policy.evaluate('run_command', { program: 'git', args: ['push'] }, 'auto-workspace').required).toBe(true)
  })

  test('file deletion always requires approval', () => {
    expect(policy.evaluate('propose_file_delete', { path: 'src/a.ts' }, 'ask').required).toBe(true)
    expect(policy.evaluate('propose_file_delete', { path: 'src/a.ts' }, 'auto-workspace').required).toBe(true)
  })
})
