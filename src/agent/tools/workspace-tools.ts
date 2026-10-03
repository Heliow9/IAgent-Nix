import { z } from 'zod'

import type { WorkspaceService } from '../../main/workspace/workspace-service'
import type { ChangeService } from '../changes/change-service'
import { runCommand } from './command-tool'
import type { ToolRegistry } from './tool-registry'

export function registerWorkspaceTools(
  registry: ToolRegistry,
  getWorkspace: () => WorkspaceService,
  changes: ChangeService
): void {
  registry.register(definition('list_files', 'List files in the workspace', z.object({ path: z.string().default('') }), 'read'),
    ({ path }) => getWorkspace().list(path))
  registry.register(definition('search_files', 'Search text in workspace files. Use query for the text and optional path to limit results to a folder.', z.object({
    query: z.string().min(1),
    path: z.string().optional(),
    maxResults: z.number().int().positive().max(500).default(100)
  }), 'read'), ({ query, path, maxResults }) =>
    getWorkspace().search(query, { path, maxResults }))
  registry.register(definition('read_file', 'Read a text file', z.object({ path: z.string().min(1), startLine: z.number().int().positive().optional(), endLine: z.number().int().positive().optional() }), 'read'),
    ({ path, startLine, endLine }) => getWorkspace().readText(path, { startLine, endLine }))
  registry.register(definition('open_file_in_editor', 'Open an existing workspace file in the visual code editor. Use this when the user asks to open, show, or navigate to a file in the editor. Do not use read_file as a substitute and do not paste the file content into chat.', z.object({ path: z.string().min(1) }), 'read'),
    async ({ path }) => {
      await getWorkspace().readText(path, { startLine: 1, endLine: 1 })
      return { action: 'open_file_in_editor' as const, path }
    })
  registry.register(definition('propose_file_change', 'Create a new file or replace an existing file with its COMPLETE content. Never send a diff or partial file; use propose_file_patch for localized edits.', z.object({ path: z.string().min(1), content: z.string() }), 'write'),
    ({ path, content }, context) => changes.propose({ kind: 'write', path, content, runId: context.runId }))
  registry.register(definition('propose_file_patch', 'Safely edit an existing file by exact, unique search/replace blocks while preserving all unrelated content.', z.object({
    path: z.string().min(1),
    edits: z.array(z.object({ search: z.string().min(1), replace: z.string() })).min(1).max(50)
  }), 'write'), ({ path, edits }, context) => changes.proposePatch({ path, edits, runId: context.runId }))
  registry.register(definition('propose_file_delete', 'Propose deleting a file', z.object({ path: z.string().min(1) }), 'delete'),
    ({ path }, context) => changes.propose({ kind: 'delete', path, runId: context.runId }))
  registry.register(definition('run_command', 'Run a program with explicit arguments', z.object({ program: z.string().min(1), args: z.array(z.string()).default([]), timeoutMs: z.number().int().positive().max(600_000).optional() }), 'command'),
    ({ program, args, timeoutMs }, context) => runCommand({ program, args, timeoutMs, cwd: getWorkspace().root }, context.signal))
  registry.register(definition('get_git_status', 'Read Git status and diff', z.object({}), 'read'),
    async (_args, context) => ({
      status: await runCommand({ program: 'git', args: ['status', '--short'], cwd: getWorkspace().root }, context.signal),
      diff: await runCommand({ program: 'git', args: ['diff', '--'], cwd: getWorkspace().root }, context.signal)
    }))
  registry.register(definition('create_architecture_document', 'Propose a Markdown or Mermaid architecture document', z.object({ path: z.string().min(1), content: z.string() }), 'write'),
    ({ path, content }, context) => changes.propose({ kind: 'write', path, content, runId: context.runId }))
}

function definition<T>(name: string, description: string, schema: z.ZodType<T>, effect: 'read' | 'write' | 'delete' | 'command') {
  const parameters = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>
  if (parameters.type === 'object') parameters.additionalProperties = false
  return { name, description, schema, effect, phase: 'workspace' as const, parameters }
}
