import { z } from 'zod'

export const permissionModeSchema = z.enum(['ask', 'auto-workspace'])
export type PermissionMode = z.infer<typeof permissionModeSchema>

export const runStatusSchema = z.enum([
  'queued',
  'running',
  'waiting_approval',
  'completed',
  'failed',
  'cancelled'
])
export type RunStatus = z.infer<typeof runStatusSchema>

export const workspaceEntrySchema = z.object({
  name: z.string().min(1),
  path: z.string(),
  kind: z.enum(['file', 'directory']),
  size: z.number().int().nonnegative().optional()
})
export type WorkspaceEntry = z.infer<typeof workspaceEntrySchema>

const eventBase = {
  runId: z.string().min(1),
  timestamp: z.string().datetime()
}

export const agentEventSchema = z.discriminatedUnion('type', [
  z.object({ ...eventBase, type: z.literal('run.started') }),
  z.object({ ...eventBase, type: z.literal('assistant.delta'), delta: z.string() }),
  z.object({ ...eventBase, type: z.literal('assistant.completed'), content: z.string() }),
  z.object({ ...eventBase, type: z.literal('tool.requested'), toolCallId: z.string(), name: z.string(), arguments: z.unknown() }),
  z.object({ ...eventBase, type: z.literal('tool.started'), toolCallId: z.string(), name: z.string() }),
  z.object({ ...eventBase, type: z.literal('tool.completed'), toolCallId: z.string(), name: z.string(), result: z.unknown() }),
  z.object({ ...eventBase, type: z.literal('approval.requested'), approvalId: z.string(), summary: z.string() }),
  z.object({ ...eventBase, type: z.literal('approval.resolved'), approvalId: z.string(), decision: z.enum(['approved', 'rejected']) }),
  z.object({ ...eventBase, type: z.literal('file.proposed'), proposalId: z.string(), path: z.string(), diff: z.string() }),
  z.object({ ...eventBase, type: z.literal('file.applied'), proposalId: z.string(), path: z.string() }),
  z.object({ ...eventBase, type: z.literal('run.failed'), message: z.string() }),
  z.object({ ...eventBase, type: z.literal('run.cancelled') }),
  z.object({ ...eventBase, type: z.literal('run.completed') })
])
export type AgentEvent = z.infer<typeof agentEventSchema>

export const openWorkspaceRequestSchema = z.object({ root: z.string().min(1) })
export const listWorkspaceRequestSchema = z.object({ path: z.string().default('') })
export const readTextRequestSchema = z.object({
  path: z.string().min(1),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional()
})
export const saveTextRequestSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  expectedHash: z.string().optional()
})
export const startAgentRunRequestSchema = z.object({
  sessionId: z.string().min(1),
  prompt: z.string().min(1),
  permissionMode: permissionModeSchema.default('ask'),
  attachedFiles: z.array(z.string()).default([])
})

export interface DesktopAPI {
  app: {
    platform: NodeJS.Platform
    electronVersion: string
  }
}
