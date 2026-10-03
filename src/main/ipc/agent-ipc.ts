import { ipcMain } from 'electron'
import { z } from 'zod'

import { ChangeConflictError, type ChangeService } from '../../agent/changes/change-service'
import type { RunScheduler } from '../../agent/runtime/run-scheduler'
import { startAgentRunRequestSchema } from '../../shared/contracts'

const runIdSchema = z.object({ runId: z.string().min(1) })
const approvalSchema = runIdSchema.extend({
  approvalId: z.string().min(1),
  decision: z.enum(['approved', 'rejected'])
})
const proposalSchema = z.object({ proposalId: z.string().min(1) })

export function registerAgentIpc(runner: RunScheduler, changes: ChangeService): void {
  ipcMain.handle('agent:start', (_event, payload) => runner.start(startAgentRunRequestSchema.parse(payload)))
  ipcMain.handle('agent:resume', (_event, payload) => runner.resume(runIdSchema.parse(payload).runId))
  ipcMain.handle('agent:cancel', (_event, payload) => runner.cancel(runIdSchema.parse(payload).runId))
  ipcMain.handle('agent:resolveApproval', (_event, payload) => {
    const input = approvalSchema.parse(payload)
    runner.resolveApproval(input.runId, input.approvalId, input.decision)
  })
  ipcMain.handle('agent:resolveAllApprovals', (_event, payload) => {
    const input = runIdSchema.extend({ decision: z.enum(['approved', 'rejected']) }).parse(payload)
    runner.resolveAllApprovals(input.runId, input.decision)
  })
  ipcMain.handle('agent:listProposals', () => changes.list())
  ipcMain.handle('agent:applyProposal', async (_event, payload) => proposalAction(() => changes.apply(proposalSchema.parse(payload).proposalId)))
  ipcMain.handle('agent:rejectProposal', async (_event, payload) => proposalAction(() => changes.reject(proposalSchema.parse(payload).proposalId)))
}

async function proposalAction<T>(action: () => Promise<T>): Promise<
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } }
> {
  try {
    return { ok: true, value: await action() }
  } catch (error) {
    const code = error instanceof ChangeConflictError
      ? 'CHANGE_CONFLICT'
      : error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'PROPOSAL_ACTION_FAILED'
    return { ok: false, error: { code, message: error instanceof Error ? error.message : 'Nao foi possivel concluir a proposta.' } }
  }
}
