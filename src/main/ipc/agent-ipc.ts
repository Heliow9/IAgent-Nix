import { ipcMain } from 'electron'
import { z } from 'zod'

import type { ChangeService } from '../../agent/changes/change-service'
import type { AgentRunner } from '../../agent/runtime/agent-runner'
import { startAgentRunRequestSchema } from '../../shared/contracts'

const runIdSchema = z.object({ runId: z.string().min(1) })
const approvalSchema = runIdSchema.extend({
  approvalId: z.string().min(1),
  decision: z.enum(['approved', 'rejected'])
})
const proposalSchema = z.object({ proposalId: z.string().min(1) })

export function registerAgentIpc(runner: AgentRunner, changes: ChangeService): void {
  ipcMain.handle('agent:start', (_event, payload) => runner.start(startAgentRunRequestSchema.parse(payload)))
  ipcMain.handle('agent:cancel', (_event, payload) => { runner.cancel(runIdSchema.parse(payload).runId) })
  ipcMain.handle('agent:resolveApproval', (_event, payload) => {
    const input = approvalSchema.parse(payload)
    runner.resolveApproval(input.runId, input.approvalId, input.decision)
  })
  ipcMain.handle('agent:listProposals', () => changes.list())
  ipcMain.handle('agent:applyProposal', (_event, payload) => changes.apply(proposalSchema.parse(payload).proposalId))
  ipcMain.handle('agent:rejectProposal', (_event, payload) => changes.reject(proposalSchema.parse(payload).proposalId))
}
