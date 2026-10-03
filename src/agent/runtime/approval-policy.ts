import type { PermissionMode } from '../../shared/contracts'

export interface ApprovalDecision {
  required: boolean
  reason?: string
}

const READ_TOOLS = new Set(['list_files', 'search_files', 'read_file', 'get_git_status', 'workspace_overview', 'search_symbols', 'related_files', 'list_project_memory', 'delegate_task', 'mcp_list_tools'])
const SAFE_AUTOPILOT_PROGRAMS = new Set(['npm', 'npm.cmd', 'pnpm', 'pnpm.cmd', 'yarn', 'yarn.cmd', 'npx', 'npx.cmd', 'node', 'python', 'python3', 'pytest', 'tsc', 'eslint', 'vitest', 'jest'])
const DANGEROUS_TOKENS = /(?:^|\s)(?:rm|rmdir|del|format|shutdown|reboot|diskpart|mkfs|dd)(?:\s|$)|--force\b|\breset\s+--hard\b|\bclean\s+-fd/i

export class ApprovalPolicy {
  evaluate(toolName: string, args: unknown, mode: PermissionMode, effect?: 'read' | 'write' | 'delete' | 'command'): ApprovalDecision {
    if (effect === 'read' || READ_TOOLS.has(toolName) || toolName === 'verify_workspace' || toolName === 'remember_project_fact') return { required: false }
    if (toolName === 'propose_file_delete') return { required: true, reason: 'Exclusão de arquivo sempre exige aprovação' }
    if (toolName === 'mcp_call_tool') return { required: true, reason: 'Ferramentas MCP podem causar efeitos fora do workspace' }
    if (toolName === 'run_command') return this.commandDecision(args, mode)
    if ((mode === 'auto-workspace' || mode === 'autopilot') && (toolName === 'propose_file_change' || toolName === 'propose_file_patch' || toolName === 'create_architecture_document')) return { required: false }
    return { required: true, reason: 'Esta ação altera o workspace' }
  }

  private commandDecision(args: unknown, mode: PermissionMode): ApprovalDecision {
    if (mode === 'ask') return { required: true, reason: 'Comandos exigem aprovação no modo Perguntar' }
    if (!args || typeof args !== 'object') return { required: true, reason: 'Argumentos do comando são inválidos' }
    const input = args as { program?: unknown; args?: unknown }
    const program = typeof input.program === 'string' ? input.program.toLowerCase() : ''
    const commandArgs = Array.isArray(input.args) ? input.args.map(String) : []
    const flat = `${program} ${commandArgs.join(' ')}`
    const readOnlyGit = program === 'git' && ['status', 'diff', 'log', 'show', 'branch'].includes(commandArgs[0] ?? '')
    const readOnlySearch = ['rg', 'grep'].includes(program)
    if (readOnlyGit || readOnlySearch) return { required: false }
    if (mode === 'autopilot' && SAFE_AUTOPILOT_PROGRAMS.has(program) && !DANGEROUS_TOKENS.test(flat)) return { required: false }
    return { required: true, reason: mode === 'autopilot' ? 'Comando fora da lista segura do Autopilot' : 'Comando pode alterar arquivos, acessar rede ou executar código do projeto' }
  }
}
