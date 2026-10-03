import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { WorkspaceService } from '../../main/workspace/workspace-service'
import { ChangeConflictError, ChangeService } from './change-service'

describe('ChangeService', () => {
  let root: string
  let workspace: WorkspaceService

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'groq-ide-change-'))
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'app.ts'), 'export const value = 1\n', 'utf8')
    workspace = await WorkspaceService.open(root)
  })

  afterEach(async () => {
    const { rm } = await import('node:fs/promises')
    await rm(root, { recursive: true, force: true })
  })

  test('proposes and applies a file replacement with a reviewable diff', async () => {
    const service = new ChangeService(() => workspace)
    const proposal = await service.propose({ kind: 'write', path: 'src/app.ts', content: 'export const value = 2\n' })

    expect(proposal.diff).toContain('-export const value = 1')
    expect(proposal.diff).toContain('+export const value = 2')

    await service.apply(proposal.id)
    expect(await readFile(join(root, 'src', 'app.ts'), 'utf8')).toBe('export const value = 2\n')
  })

  test('preserves externally changed content when a proposal base hash is stale', async () => {
    const service = new ChangeService(() => workspace)
    const proposal = await service.propose({ kind: 'write', path: 'src/app.ts', content: 'agent version\n' })
    const original = await workspace.readText('src/app.ts')
    await workspace.writeTextAtomic('src/app.ts', 'human version\n', original.hash)

    await expect(service.apply(proposal.id)).rejects.toBeInstanceOf(ChangeConflictError)
    expect(await readFile(join(root, 'src', 'app.ts'), 'utf8')).toBe('human version\n')
  })

  test('requires an explicit apply before deleting a proposed file', async () => {
    const service = new ChangeService(() => workspace)
    const proposal = await service.propose({ kind: 'delete', path: 'src/app.ts' })

    expect(await readFile(join(root, 'src', 'app.ts'), 'utf8')).toContain('value')
    await service.reject(proposal.id)
    await expect(service.apply(proposal.id)).rejects.toThrow('Proposal is not pending')
  })
})
