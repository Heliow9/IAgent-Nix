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

  test('reloads and updates proposals through durable persistence', async () => {
    const saved = new Map<string, any>()
    const persistence = {
      listProposals: () => [...saved.values()],
      upsertProposal: async (proposal: any) => { saved.set(proposal.id, structuredClone(proposal)) }
    }
    const first = new ChangeService(() => workspace, undefined, persistence)
    const proposal = await first.propose({ kind: 'write', path: 'src/app.ts', content: 'persisted\n', runId: 'run-1' })

    const second = new ChangeService(() => workspace, undefined, persistence)
    expect(second.list()).toEqual([expect.objectContaining({ id: proposal.id, status: 'pending' })])
    await second.apply(proposal.id)

    expect(saved.get(proposal.id).status).toBe('applied')
  })

  test('creates a localized patch while preserving all unrelated content', async () => {
    const service = new ChangeService(() => workspace)
    const proposal = await service.proposePatch({
      path: 'src/app.ts',
      edits: [{ search: 'export const value = 1', replace: 'export const value = 2' }]
    })

    expect(proposal.content).toBe('export const value = 2\n')
    expect(proposal.diff).toContain('-export const value = 1')
    expect(proposal.diff).toContain('+export const value = 2')
  })

  test('consolidates repeated edits from the same run into one cumulative proposal', async () => {
    const service = new ChangeService(() => workspace)
    const first = await service.proposePatch({
      path: 'src/app.ts', runId: 'run-1',
      edits: [{ search: 'value = 1', replace: 'value = 2' }]
    })
    const second = await service.proposePatch({
      path: 'src/app.ts', runId: 'run-1',
      edits: [{ search: 'value = 2', replace: 'value = 3' }]
    })

    expect(second.id).toBe(first.id)
    expect(service.list()).toHaveLength(1)
    expect(second.content).toBe('export const value = 3\n')

    await service.apply(second.id)
    expect(await readFile(join(root, 'src', 'app.ts'), 'utf8')).toBe('export const value = 3\n')
  })

  test('keeps proposals from concurrent runs independent', async () => {
    const service = new ChangeService(() => workspace)
    const first = await service.propose({ kind: 'write', path: 'src/app.ts', content: 'run one\n', runId: 'run-1' })
    const second = await service.propose({ kind: 'write', path: 'src/app.ts', content: 'run two\n', runId: 'run-2' })

    expect(second.id).not.toBe(first.id)
    await service.apply(first.id)
    await expect(service.apply(second.id)).rejects.toBeInstanceOf(ChangeConflictError)
  })

  test('rejects ambiguous localized edits and patch protocol markers in file content', async () => {
    const service = new ChangeService(() => workspace)
    await expect(service.proposePatch({ path: 'src/app.ts', edits: [{ search: 'missing text', replace: 'new' }] }))
      .rejects.toMatchObject({ code: 'PATCH_SEARCH_NOT_FOUND' })
    await expect(service.propose({ kind: 'write', path: 'src/app.ts', content: '+*** End Patch\n' }))
      .rejects.toMatchObject({ code: 'INVALID_GENERATED_CONTENT' })
  })

  test('rejects an unexpectedly truncated replacement of an existing source file', async () => {
    const original = Array.from({ length: 30 }, (_, index) => `export const value${index} = ${index}`).join('\n')
    await workspace.writeTextAtomic('src/large.ts', `${original}\n`)
    const service = new ChangeService(() => workspace)

    await expect(service.propose({ kind: 'write', path: 'src/large.ts', content: 'export const birthDate = true\n' }))
      .rejects.toMatchObject({ code: 'UNEXPECTED_LARGE_DELETION' })
  })
})
