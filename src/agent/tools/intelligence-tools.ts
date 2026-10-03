import { z } from 'zod'

import type { WorkspaceIntelligenceService } from '../../main/intelligence/workspace-intelligence'
import type { ProjectMemoryService } from '../../main/memory/project-memory'
import type { McpService } from '../../main/mcp/mcp-service'
import type { WorkspaceService } from '../../main/workspace/workspace-service'
import type { SubagentService } from '../orchestration/subagent-service'
import type { VerificationEngine } from '../verification/verification-engine'
import type { ToolRegistry } from './tool-registry'

export function registerIntelligenceTools(
  registry: ToolRegistry,
  getWorkspace: () => WorkspaceService,
  intelligence: WorkspaceIntelligenceService,
  memory: ProjectMemoryService,
  verification: VerificationEngine,
  subagents: SubagentService,
  mcp: McpService
): void {
  registry.register(definition('workspace_overview', 'Get a compact indexed overview of the workspace before broad exploration.', z.object({}), 'read'), async () => {
    intelligence.setRoot(getWorkspace().root)
    return intelligence.overviewText()
  })
  registry.register(definition('workspace_projects', 'List every detected project/subproject in the workspace, including nested monorepo apps and their manifests. Use this before saying you analyzed an entire workspace.', z.object({}), 'read'), async () => {
    intelligence.setRoot(getWorkspace().root)
    return intelligence.projects()
  })
  registry.register(definition('search_symbols', 'Search indexed functions, classes, interfaces, types and constants by symbol name.', z.object({ query: z.string().min(1), maxResults: z.number().int().positive().max(200).default(50) }), 'read'), async ({ query, maxResults }) => {
    intelligence.setRoot(getWorkspace().root)
    return intelligence.searchSymbols(query, maxResults)
  })
  registry.register(definition('related_files', 'Find files imported by a file and files that import it.', z.object({ path: z.string().min(1) }), 'read'), async ({ path }) => {
    intelligence.setRoot(getWorkspace().root)
    return intelligence.relatedFiles(path)
  })
  registry.register(definition('list_project_memory', 'Read durable project decisions, conventions and known issues saved by NIX.', z.object({}), 'read'), () => memory.list(getWorkspace().root))
  registry.register(definition('remember_project_fact', 'Persist a durable architecture decision, convention, issue or fact for future NIX chats. Do not store secrets.', z.object({ category: z.enum(['architecture','decision','convention','issue','fact']), text: z.string().min(3).max(4000) }), 'write'), ({ category, text }) => memory.add(getWorkspace().root, category, text))
  registry.register(definition('verify_workspace', 'Run detected project checks such as typecheck, lint, tests and build. Use before declaring code changes complete.', z.object({}), 'command'), (_args, context) => verification.run(context.signal))
  registry.register(definition('delegate_task', 'Ask an independent specialist subagent to plan, review, debug, test or assess architecture. It cannot modify files.', z.object({ role: z.enum(['planner','reviewer','debugger','tester','architect']), task: z.string().min(1), context: z.string().default('') }), 'read'), ({ role, task, context }, ctx) => subagents.run(role, task, context, ctx.signal))
  registry.register(definition('mcp_list_tools', 'List tools exposed by a configured MCP server.', z.object({ serverId: z.string().min(1) }), 'read'), ({ serverId }) => mcp.listTools(serverId))
  registry.register(definition('mcp_call_tool', 'Call a tool on a configured MCP server. Use only when the user task requires that external capability.', z.object({ serverId: z.string().min(1), tool: z.string().min(1), arguments: z.record(z.string(), z.unknown()).default({}) }), 'command'), ({ serverId, tool, arguments: toolArguments }, _ctx) => mcp.callTool(serverId, tool, toolArguments))
}

function definition<T>(name: string, description: string, schema: z.ZodType<T>, effect: 'read' | 'write' | 'delete' | 'command') {
  const parameters = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>
  if (parameters.type === 'object') parameters.additionalProperties = false
  return { name, description, schema, effect, phase: 'workspace' as const, parameters }
}
