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

export class ChangeConflictError extends Error {
  constructor(message = 'File changed after the proposal was created') {
    super(message)
    this.name = 'ChangeConflictError'
  }
}

export class ChangeService {
  private readonly proposals = new Map<string, ChangeProposal>()

  constructor(
    private readonly getWorkspace: () => WorkspaceService,
    private readonly eventBus?: RunEventBus
  ) {}

  async propose(input: { kind: ChangeKind; path: string; content?: string; runId?: string }): Promise<ChangeProposal> {
    const workspace = this.getWorkspace()
    const current = await readIfPresent(workspace, input.path)
    if (input.kind === 'delete' && !current) throw new Error('Cannot delete a missing file')
    const proposal: ChangeProposal = {
      id: randomUUID(), runId: input.runId, kind: input.kind, path: input.path,
      content: input.content, baseHash: current?.hash,
      diff: createDiff(input.path, current?.content ?? '', input.kind === 'delete' ? '' : input.content ?? ''),
      status: 'pending'
    }
    this.proposals.set(proposal.id, proposal)
    if (proposal.runId) this.eventBus?.publish({
      type: 'file.proposed', runId: proposal.runId, timestamp: new Date().toISOString(),
      proposalId: proposal.id, path: proposal.path, diff: proposal.diff
    })
    return structuredClone(proposal)
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
        if (existing) throw new ChangeConflictError('A file now exists at the proposed path')
        await workspace.writeTextAtomic(proposal.path, proposal.content ?? '')
      }
    } catch (error) {
      if (error instanceof ChangeConflictError || (error && typeof error === 'object' && 'code' in error && error.code === 'CONTENT_CONFLICT')) {
        throw new ChangeConflictError()
      }
      throw error
    }
    proposal.status = 'applied'
    if (proposal.runId) this.eventBus?.publish({
      type: 'file.applied', runId: proposal.runId, timestamp: new Date().toISOString(),
      proposalId: proposal.id, path: proposal.path
    })
    return structuredClone(proposal)
  }

  async reject(proposalId: string): Promise<ChangeProposal> {
    const proposal = this.requirePending(proposalId)
    proposal.status = 'rejected'
    return structuredClone(proposal)
  }

  private requirePending(proposalId: string): ChangeProposal {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) throw new Error(`Unknown proposal: ${proposalId}`)
    if (proposal.status !== 'pending') throw new Error('Proposal is not pending')
    return proposal
  }
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
