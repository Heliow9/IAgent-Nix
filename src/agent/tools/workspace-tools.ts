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
  registry.register(definition('search_files', 'Search text in workspace files', z.object({ query: z.string().min(1), maxResults: z.number().int().positive().max(500).default(100) }), 'read'),
    ({ query, maxResults }) => getWorkspace().search(query, { maxResults }))
  registry.register(definition('read_file', 'Read a text file', z.object({ path: z.string().min(1), startLine: z.number().int().positive().optional(), endLine: z.number().int().positive().optional() }), 'read'),
    ({ path, startLine, endLine }) => getWorkspace().readText(path, { startLine, endLine }))
  registry.register(definition('propose_file_change', 'Propose creating or replacing a file', z.object({ path: z.string().min(1), content: z.string() }), 'write'),
    ({ path, content }, context) => changes.propose({ kind: 'write', path, content, runId: context.runId }))
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
  return { name, description, schema, effect, phase: 'workspace' as const, parameters: z.toJSONSchema(schema) as Record<string, unknown> }
}
