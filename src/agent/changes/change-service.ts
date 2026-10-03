import { randomUUID } from 'node:crypto'

import type { RunEventBus } from '../../main/state/run-events'
import type { WorkspaceService } from '../../main/workspace/workspace-service'

export type ChangeKind = 'write' | 'delete'
export type ProposalStatus = 'pending' | 'applied' | 'rejected'

export interface ChangeProposal {
  id: string
  runId?: string
  kind: ChangeKind
  path: string
  content?: string
  baseHash?: string
  diff: string
  status: ProposalStatus
}

export interface ProposalPersistence {
  listProposals(): ChangeProposal[]
  upsertProposal(proposal: ChangeProposal): Promise<void>
}

export class ChangeConflictError extends Error {
  constructor(message = 'O arquivo mudou depois que a proposta foi criada. O NIX preservou a versao atual e nao sobrescreveu o arquivo.') {
    super(message)
    this.name = 'ChangeConflictError'
  }
}

export type ChangeValidationCode = 'PATCH_SEARCH_NOT_FOUND' | 'PATCH_SEARCH_AMBIGUOUS' | 'INVALID_GENERATED_CONTENT' | 'UNEXPECTED_LARGE_DELETION'

export class ChangeValidationError extends Error {
  constructor(public readonly code: ChangeValidationCode, message: string) {
    super(message)
    this.name = 'ChangeValidationError'
  }
}

export class ChangeService {
  private readonly proposals = new Map<string, ChangeProposal>()

  constructor(
    private readonly getWorkspace: () => WorkspaceService,
    private readonly eventBus?: RunEventBus,
    private readonly persistence?: ProposalPersistence
  ) {
    for (const proposal of persistence?.listProposals() ?? []) this.proposals.set(proposal.id, structuredClone(proposal))
  }

  async propose(input: { kind: ChangeKind; path: string; content?: string; runId?: string }): Promise<ChangeProposal> {
    const workspace = this.getWorkspace()
    const current = await readIfPresent(workspace, input.path)
    const pending = input.runId ? this.pendingProposalFor(input.path, input.runId) : undefined

    // A single agent run may refine the same file several times before the user
    // presses Apply. Keep one cumulative proposal for that run/path instead of
    // creating a stack of proposals that all point at the same stale base hash.
    if (pending) {
      assertProposalBaseIsCurrent(pending, current)
      const effectiveBefore = pending.kind === 'write' ? pending.content ?? '' : current?.content
      if (input.kind === 'delete' && !current) throw new Error('Cannot delete a missing file')
      if (input.kind === 'write') validateGeneratedContent(effectiveBefore, input.content ?? '')

      pending.kind = input.kind
      pending.content = input.kind === 'write' ? input.content : undefined
      pending.diff = createDiff(input.path, current?.content ?? '', input.kind === 'delete' ? '' : input.content ?? '')
      await this.persistence?.upsertProposal(pending)
      if (pending.runId) this.eventBus?.publish({
        type: 'file.proposed', runId: pending.runId, timestamp: new Date().toISOString(),
        proposalId: pending.id, path: pending.path, diff: pending.diff
      })
      return structuredClone(pending)
    }

    if (input.kind === 'delete' && !current) throw new Error('Cannot delete a missing file')
    if (input.kind === 'write') validateGeneratedContent(current?.content, input.content ?? '')
    const proposal: ChangeProposal = {
      id: randomUUID(), runId: input.runId, kind: input.kind, path: input.path,
      content: input.content, baseHash: current?.hash,
      diff: createDiff(input.path, current?.content ?? '', input.kind === 'delete' ? '' : input.content ?? ''),
      status: 'pending'
    }
    this.proposals.set(proposal.id, proposal)
    await this.persistence?.upsertProposal(proposal)
    if (proposal.runId) this.eventBus?.publish({
      type: 'file.proposed', runId: proposal.runId, timestamp: new Date().toISOString(),
      proposalId: proposal.id, path: proposal.path, diff: proposal.diff
    })
    return structuredClone(proposal)
  }

  async proposePatch(input: { path: string; edits: Array<{ search: string; replace: string }>; runId?: string }): Promise<ChangeProposal> {
    const pending = input.runId ? this.pendingProposalFor(input.path, input.runId) : undefined
    const current = pending?.kind === 'write'
      ? { content: pending.content ?? '' }
      : await this.getWorkspace().readText(input.path)
    let content = current.content
    for (const edit of input.edits) {
      const first = content.indexOf(edit.search)
      if (first < 0) throw new ChangeValidationError('PATCH_SEARCH_NOT_FOUND', 'The exact search text was not found. Read the current file and retry with an exact excerpt.')
      if (content.indexOf(edit.search, first + edit.search.length) >= 0) {
        throw new ChangeValidationError('PATCH_SEARCH_AMBIGUOUS', 'The search text appears more than once. Include more surrounding context so the edit is unique.')
      }
      content = `${content.slice(0, first)}${edit.replace}${content.slice(first + edit.search.length)}`
    }
    return this.propose({ kind: 'write', path: input.path, content, runId: input.runId })
  }

  list(): ChangeProposal[] {
    return [...this.proposals.values()].map((proposal) => structuredClone(proposal))
  }

  async apply(proposalId: string): Promise<ChangeProposal> {
    const proposal = this.requirePending(proposalId)
    const workspace = this.getWorkspace()
    try {
      if (proposal.kind === 'delete') {
        const current = await workspace.readText(proposal.path)
        if (current.hash !== proposal.baseHash) throw new ChangeConflictError()
        await workspace.remove(proposal.path)
      } else if (proposal.baseHash) {
        await workspace.writeTextAtomic(proposal.path, proposal.content ?? '', proposal.baseHash)
      } else {
        const existing = await readIfPresent(workspace, proposal.path)
        if (existing) throw new ChangeConflictError('Um arquivo foi criado nesse caminho depois da proposta. O NIX nao sobrescreveu o arquivo novo.')
        await workspace.writeTextAtomic(proposal.path, proposal.content ?? '')
      }
    } catch (error) {
      if (error instanceof ChangeConflictError || (error && typeof error === 'object' && 'code' in error && error.code === 'CONTENT_CONFLICT')) {
        throw new ChangeConflictError()
      }
      throw error
    }
    proposal.status = 'applied'
    await this.persistence?.upsertProposal(proposal)
    if (proposal.runId) this.eventBus?.publish({
      type: 'file.applied', runId: proposal.runId, timestamp: new Date().toISOString(),
      proposalId: proposal.id, path: proposal.path
    })
    return structuredClone(proposal)
  }

  async reject(proposalId: string): Promise<ChangeProposal> {
    const proposal = this.requirePending(proposalId)
    proposal.status = 'rejected'
    await this.persistence?.upsertProposal(proposal)
    return structuredClone(proposal)
  }

  private requirePending(proposalId: string): ChangeProposal {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) throw new Error(`Unknown proposal: ${proposalId}`)
    if (proposal.status !== 'pending') throw new Error('Proposal is not pending')
    return proposal
  }

  private pendingProposalFor(path: string, runId: string): ChangeProposal | undefined {
    return [...this.proposals.values()].reverse().find((proposal) => (
      proposal.status === 'pending' && proposal.path === path && proposal.runId === runId
    ))
  }
}

function assertProposalBaseIsCurrent(
  proposal: ChangeProposal,
  current: { content: string; hash: string } | undefined
): void {
  if (proposal.baseHash) {
    if (!current || current.hash !== proposal.baseHash) throw new ChangeConflictError()
    return
  }
  if (current) throw new ChangeConflictError('Um arquivo foi criado nesse caminho depois da proposta. O NIX nao sobrescreveu o arquivo novo.')
}

async function readIfPresent(workspace: WorkspaceService, path: string): Promise<{ content: string; hash: string } | undefined> {
  try {
    return await workspace.readText(path)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

function createDiff(path: string, before: string, after: string): string {
  const removed = before.split(/\r?\n/).filter((line, index, lines) => line || index < lines.length - 1).map((line) => `-${line}`)
  const added = after.split(/\r?\n/).filter((line, index, lines) => line || index < lines.length - 1).map((line) => `+${line}`)
  return [`--- a/${path}`, `+++ b/${path}`, '@@', ...removed, ...added].join('\n')
}

function validateGeneratedContent(before: string | undefined, after: string): void {
  if (/(?:^|\n)\s*\+?\*\*\*\s+(?:Begin|End) Patch\b/.test(after)) {
    throw new ChangeValidationError('INVALID_GENERATED_CONTENT', 'File content contains patch protocol markers. Send plain file content or use propose_file_patch.')
  }
  if (!before) return
  const beforeLines = before.split(/\r?\n/).filter(Boolean).length
  const afterLines = after.split(/\r?\n/).filter(Boolean).length
  if (beforeLines >= 20 && afterLines < Math.ceil(beforeLines * 0.6)) {
    throw new ChangeValidationError(
      'UNEXPECTED_LARGE_DELETION',
      `Replacement would remove more than 40% of an existing ${beforeLines}-line file. Use propose_file_patch to preserve unrelated code.`
    )
  }
}
