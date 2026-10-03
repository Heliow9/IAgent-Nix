import type { PermissionMode } from '../../shared/contracts'

export interface ApprovalDecision {
  required: boolean
  reason?: string
}

const READ_TOOLS = new Set(['list_files', 'search_files', 'read_file', 'get_git_status'])

export class ApprovalPolicy {
  evaluate(toolName: string, args: unknown, mode: PermissionMode, effect?: 'read' | 'write' | 'delete' | 'command'): ApprovalDecision {
    if (effect === 'read' || READ_TOOLS.has(toolName)) return { required: false }
    if (toolName === 'propose_file_delete') return { required: true, reason: 'File deletion always requires approval' }
    if (toolName === 'run_command') return this.commandDecision(args, mode)
    if (mode === 'auto-workspace' && (toolName === 'propose_file_change' || toolName === 'create_architecture_document')) {
      return { required: false }
    }
    return { required: true, reason: 'This action changes the workspace' }
  }

  private commandDecision(args: unknown, mode: PermissionMode): ApprovalDecision {
    if (mode === 'ask') return { required: true, reason: 'Commands require approval in ask mode' }
    if (!args || typeof args !== 'object') return { required: true, reason: 'Command arguments are invalid' }
    const input = args as { program?: unknown; args?: unknown }
    const program = typeof input.program === 'string' ? input.program.toLowerCase() : ''
    const commandArgs = Array.isArray(input.args) ? input.args.map(String) : []
    const readOnlyGit = program === 'git' && ['status', 'diff', 'log', 'show'].includes(commandArgs[0] ?? '')
    const readOnlySearch = ['rg', 'grep'].includes(program)
    if (readOnlyGit || readOnlySearch) return { required: false }
    return { required: true, reason: 'Command may mutate files, access the network, or run project code' }
  }
}
