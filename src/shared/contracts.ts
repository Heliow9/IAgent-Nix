import { z } from 'zod'

export const permissionModeSchema = z.enum(['ask', 'auto-workspace', 'autopilot'])
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

export interface ImportResolution {
  kind: 'workspace' | 'external' | 'unresolved'
  path?: string
}

const eventBase = {
  runId: z.string().min(1),
  timestamp: z.string().datetime()
}

export const agentEventSchema = z.discriminatedUnion('type', [
  z.object({ ...eventBase, type: z.literal('run.queued'), queuePosition: z.number().int().positive() }),
  z.object({ ...eventBase, type: z.literal('run.started') }),
  z.object({ ...eventBase, type: z.literal('run.resumed') }),
  z.object({ ...eventBase, type: z.literal('run.configuration'), model: z.string().min(1), reasoningEffort: z.enum(['low', 'medium', 'high']), contextTokenBudget: z.number().int().positive(), freeTierMode: z.boolean() }),
  z.object({ ...eventBase, type: z.literal('assistant.delta'), delta: z.string() }),
  z.object({ ...eventBase, type: z.literal('assistant.completed'), content: z.string() }),
  z.object({ ...eventBase, type: z.literal('tool.requested'), toolCallId: z.string(), name: z.string(), arguments: z.unknown() }),
  z.object({ ...eventBase, type: z.literal('tool.started'), toolCallId: z.string(), name: z.string() }),
  z.object({ ...eventBase, type: z.literal('tool.completed'), toolCallId: z.string(), name: z.string(), result: z.unknown() }),
  z.object({ ...eventBase, type: z.literal('approval.requested'), approvalId: z.string(), summary: z.string() }),
  z.object({ ...eventBase, type: z.literal('approval.resolved'), approvalId: z.string(), decision: z.enum(['approved', 'rejected']) }),
  z.object({ ...eventBase, type: z.literal('file.proposed'), proposalId: z.string(), path: z.string(), diff: z.string() }),
  z.object({ ...eventBase, type: z.literal('file.applied'), proposalId: z.string(), path: z.string() }),
  z.object({ ...eventBase, type: z.literal('editor.open.requested'), path: z.string().min(1) }),
  z.object({ ...eventBase, type: z.literal('chat.title.updated'), chatId: z.string().min(1), title: z.string().min(1) }),
  z.object({ ...eventBase, type: z.literal('run.failed'), message: z.string(), resumable: z.boolean().default(false) }),
  z.object({ ...eventBase, type: z.literal('run.cancelled') }),
  z.object({ ...eventBase, type: z.literal('run.completed') })
])
export type AgentEvent = z.infer<typeof agentEventSchema>

export const chatMessageSchema = z.object({
  id: z.string().min(1),
  chatId: z.string().min(1).optional(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  attachments: z.array(z.string()).optional(),
  referencedChatIds: z.array(z.string()).optional(),
  createdAt: z.string().datetime(),
  revision: z.number().int().positive().optional(),
  deletedAt: z.string().datetime().nullable().optional()
})
export type ChatMessage = z.infer<typeof chatMessageSchema>

export const workspaceRecordSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  localRootPath: z.string().min(1),
  remoteProjectId: z.string().min(1).nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastOpenedAt: z.string().datetime(),
  revision: z.number().int().positive(),
  deletedAt: z.string().datetime().nullable().default(null)
})
export type WorkspaceRecord = z.infer<typeof workspaceRecordSchema>

export const chatRecordSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  title: z.string().min(1),
  titleSource: z.enum(['provisional', 'generated', 'manual']),
  status: z.enum(['active', 'archived']),
  summary: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  revision: z.number().int().positive(),
  deletedAt: z.string().datetime().nullable().default(null)
})
export type ChatRecord = z.infer<typeof chatRecordSchema>

export const sessionRecordSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  workspaceRoot: z.string().min(1),
  permissionMode: permissionModeSchema,
  messages: z.array(chatMessageSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})
export type SessionRecord = z.infer<typeof sessionRecordSchema>

export const runRecordSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  status: runStatusSchema,
  queueSequence: z.number().int().positive().optional(),
  prompt: z.string().optional(),
  permissionMode: permissionModeSchema.optional(),
  attachedFiles: z.array(z.string()).optional(),
  referencedChatIds: z.array(z.string()).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})
export type RunRecord = z.infer<typeof runRecordSchema>

export interface ModelSettings {
  fastModel: string
  deepModel: string
}

export type ReasoningMode = 'auto' | 'low' | 'medium' | 'high'
export type QuotaProtectionMode = 'adaptive' | 'monitor' | 'off'

export interface NixSettings extends ModelSettings {
  contextMaxCharacters: number
  contextTokenBudget: number
  maxCompletionTokens: number
  maxConcurrentRuns: number
  autoVerify: boolean
  skillMode: 'auto' | 'off'
  superpowersEnabled: boolean
  modelRouting: 'auto' | 'fast' | 'deep'
  reasoningMode: ReasoningMode
  groqFreeTierMode: boolean
  quotaProtection: QuotaProtectionMode
  groqDailyTokenLimit: number
}

export interface GroqQuotaSnapshot {
  plan: 'free' | 'custom'
  lastUpdatedAt?: string
  model?: string
  activeReasoning?: Exclude<ReasoningMode, 'auto'>
  server: {
    requestsPerDay: { limit?: number; remaining?: number; reset?: string }
    tokensPerMinute: { limit?: number; remaining?: number; reset?: string }
  }
  local: {
    date: string
    requestsToday: number
    estimatedTokensToday: number
    configuredDailyTokenLimit: number
  }
  policy: {
    freeTierMode: boolean
    protection: QuotaProtectionMode
    contextTokenBudget: number
    maxCompletionTokens: number
  }
}

export interface WorkspaceSymbol {
  name: string
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'variable' | 'method' | 'unknown'
  path: string
  line: number
  exported?: boolean
}

export interface WorkspaceImportEdge { from: string; specifier: string; resolved?: string }
export interface WorkspaceIndexSummary {
  files: number
  symbols: number
  imports: number
  indexedAt: string
  languages: Record<string, number>
}

export interface GitFileStatus { path: string; index: string; worktree: string }
export interface GitStatus { branch: string; ahead: number; behind: number; files: GitFileStatus[]; clean: boolean }

export interface ProjectMemoryItem {
  id: string
  category: 'architecture' | 'decision' | 'convention' | 'issue' | 'fact'
  text: string
  createdAt: string
  updatedAt: string
}

export interface SkillInfo {
  id: string
  name: string
  description: string
  source: 'builtin' | 'workspace' | 'external'
  enabled: boolean
}

export interface McpServerConfig { id: string; name: string; command: string; args: string[]; enabled: boolean }
export interface McpServerStatus extends McpServerConfig { connected: boolean; error?: string; toolCount?: number }


export const projectTemplateSchema = z.enum(['empty', 'node-typescript', 'react-typescript'])
export const projectTemplateInputSchema = z.object({
  name: z.string().min(1),
  location: z.string().min(1),
  template: projectTemplateSchema
})
export type ProjectTemplateInput = z.infer<typeof projectTemplateInputSchema>
export interface ProjectPreview {
  projectName: string
  targetPath: string
  template: z.infer<typeof projectTemplateSchema>
  files: string[]
  confirmationToken: string
}

export interface FileProposal {
  id: string
  runId?: string
  kind: 'write' | 'delete'
  path: string
  content?: string
  baseHash?: string
  diff: string
  status: 'pending' | 'applied' | 'rejected'
}

export interface RunSummary extends RunRecord {
  resumable: boolean
}

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
  attachedFiles: z.array(z.string()).default([]),
  referencedChatIds: z.array(z.string()).default([])
})

export interface DesktopAPI {
  app: {
    platform: NodeJS.Platform
    electronVersion: string
  }
  workspace: {
    open(root: string): Promise<{ root: string }>
    createFolder(path: string): Promise<void>
    list(path?: string): Promise<WorkspaceEntry[]>
    readText(path: string, range?: { startLine?: number; endLine?: number }): Promise<{ content: string; hash: string; totalLines: number }>
    saveText(path: string, content: string, expectedHash?: string): Promise<{ hash: string }>
    search(query: string, maxResults?: number): Promise<Array<{ path: string; line: number; column: number; preview: string }>>
    resolveImport(fromPath: string, specifier: string): Promise<ImportResolution>
  }
  intelligence: {
    rebuild(): Promise<WorkspaceIndexSummary>
    summary(): Promise<WorkspaceIndexSummary>
    searchSymbols(query: string, maxResults?: number): Promise<WorkspaceSymbol[]>
    relatedFiles(path: string): Promise<Array<{ path: string; relation: 'imports' | 'imported-by' }>>
  }
  git: {
    status(): Promise<GitStatus>
    diff(path?: string, staged?: boolean): Promise<string>
    stage(paths: string[]): Promise<void>
    unstage(paths: string[]): Promise<void>
    commit(message: string): Promise<string>
    branches(): Promise<Array<{ name: string; current: boolean }>>
    checkout(branch: string): Promise<void>
  }
  memory: {
    list(): Promise<ProjectMemoryItem[]>
    add(category: ProjectMemoryItem['category'], text: string): Promise<ProjectMemoryItem>
    remove(id: string): Promise<void>
  }
  skills: {
    list(): Promise<SkillInfo[]>
    reload(): Promise<SkillInfo[]>
  }
  mcp: {
    servers(): Promise<McpServerStatus[]>
    configure(servers: McpServerConfig[]): Promise<McpServerStatus[]>
    tools(serverId: string): Promise<Array<{ name: string; description?: string }>>
  }
  sessions: {
    list(): Promise<SessionRecord[]>
    create(input: { title: string; workspaceRoot: string }): Promise<SessionRecord>
    appendMessage(sessionId: string, role: ChatMessage['role'], content: string, referencedChatIds?: string[]): Promise<ChatMessage>
    listRuns(sessionId: string): Promise<RunSummary[]>
    events(runId: string): Promise<AgentEvent[]>
    onAgentEvent(listener: (event: AgentEvent) => void): () => void
  }
  conversations?: {
    listWorkspaces(): Promise<WorkspaceRecord[]>
    touchWorkspace(root: string): Promise<WorkspaceRecord>
    listChats(workspaceId: string, includeArchived?: boolean): Promise<ChatRecord[]>
    createChat(workspaceId: string, title?: string): Promise<ChatRecord>
    renameChat(chatId: string, title: string): Promise<ChatRecord>
    archiveChat(chatId: string): Promise<ChatRecord>
  }
  settings: {
    models(): Promise<ModelSettings>
    get(): Promise<NixSettings>
    update(patch: Partial<NixSettings>): Promise<NixSettings>
  }
  groq?: {
    quota(): Promise<GroqQuotaSnapshot>
  }
  projects: {
    preview(input: ProjectTemplateInput): Promise<ProjectPreview>
    create(input: ProjectTemplateInput, confirmationToken: string): Promise<ProjectPreview>
  }
  agent: {
    start(input: z.input<typeof startAgentRunRequestSchema>): Promise<{ runId: string; status?: RunStatus; queuePosition?: number }>
    resume(runId: string): Promise<{ runId: string }>
    cancel(runId: string): Promise<void>
    resolveApproval(runId: string, approvalId: string, decision: 'approved' | 'rejected'): Promise<void>
    resolveAllApprovals(runId: string, decision: 'approved' | 'rejected'): Promise<void>
    listProposals(): Promise<FileProposal[]>
    applyProposal(proposalId: string): Promise<FileProposal>
    rejectProposal(proposalId: string): Promise<FileProposal>
  }
  terminal: {
    create(input: { cwd: string; cols: number; rows: number }): Promise<{ id: string }>
    write(id: string, data: string): Promise<void>
    resize(id: string, cols: number, rows: number): Promise<void>
    dispose(id: string): Promise<void>
    onData(id: string, listener: (data: string) => void): () => void
    onExit(id: string, listener: (exitCode: number) => void): () => void
  }
}
