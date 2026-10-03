import type { RunStatus } from '../../../../shared/contracts'

export interface ToolActivityItem {
  id: string
  name: string
  status: 'requested' | 'running' | 'completed'
  arguments?: unknown
  result?: unknown
}

export function ToolActivity({ items, status, fileCount = 0, queuePosition, configuration }: {
  items: ToolActivityItem[]
  status: RunStatus
  fileCount?: number
  queuePosition?: number
  configuration?: { model: string; reasoningEffort: 'low' | 'medium' | 'high'; contextTokenBudget: number; freeTierMode: boolean }
}): React.JSX.Element | null {
  const active = [...items].reverse().find((item) => item.status !== 'completed')
  const summary = status === 'queued' && queuePosition
    ? `Na fila · posição ${queuePosition}`
    : items.length === 0 && (status === 'running' || status === 'queued')
    ? 'Analisando solicitação…'
    : active ? currentAction(active) : completedSummary(status, items.length, fileCount)
  return (
    <details className={`tool-activity execution-group ${status}`} aria-label="Atividade da execução">
      <summary role="status" aria-live="polite">
        <span className={`execution-state ${status}`} aria-hidden>{statusIcon(status)}</span>
        <span>{summary}</span>
        <small>{configuration ? `${shortModel(configuration.model)} · ${configuration.reasoningEffort.toUpperCase()}` : 'Detalhes'}</small>
      </summary>
      <div className="execution-details">
        {configuration && <p className="execution-config">Modelo: {configuration.model} · Reasoning: {configuration.reasoningEffort.toUpperCase()} · Contexto: {configuration.contextTokenBudget.toLocaleString('pt-BR')} tokens{configuration.freeTierMode ? ' · Free Tier' : ''}</p>}
        {items.length === 0 && status === 'completed' && <p className="execution-empty">O NIX respondeu diretamente, sem executar ferramentas.</p>}
        {items.map((item) => <article className="tool-row" key={item.id}>
          <span className={`tool-status ${toolFailed(item) ? 'failed' : item.status}`} aria-hidden>{toolFailed(item) ? '!' : item.status === 'completed' ? '✓' : item.status === 'running' ? '●' : '○'}</span>
          <div><strong>{completedAction(item.name)}</strong>{contextLabel(item.arguments) && <small>{contextLabel(item.arguments)}</small>}</div>
          <small>{toolFailed(item) ? 'falhou' : statusLabel(item.status)}</small>
          {item.result !== undefined && <pre>{formatPayload(item.result)}</pre>}
        </article>)}
      </div>
    </details>
  )
}

function completedSummary(status: RunStatus, count: number, fileCount: number): string {
  const steps = `${count} ${count === 1 ? 'etapa' : 'etapas'}`
  const files = fileCount ? ` · ${fileCount} ${fileCount === 1 ? 'arquivo alterado' : 'arquivos alterados'}` : ''
  if (status === 'failed') return `Execução interrompida · ${steps}${files}`
  if (status === 'cancelled') return `Execução cancelada · ${steps}${files}`
  if (status === 'waiting_approval') return `Aguardando aprovação · ${steps}${files}`
  if (status === 'running' || status === 'queued') return `Processando resposta · ${steps}${files}`
  return `Execução concluída · ${steps}${files}`
}

function currentAction(item: ToolActivityItem): string {
  const args = parseArguments(item.arguments)
  const target = stringValue(args, 'path')
  if (item.name === 'read_file') return target ? `Lendo ${target}…` : 'Lendo arquivo…'
  if (item.name === 'open_file_in_editor') return target ? `Abrindo ${target} no editor…` : 'Abrindo arquivo no editor…'
  if (item.name === 'search_files') return stringValue(args, 'query') ? `Pesquisando “${stringValue(args, 'query')}”…` : 'Pesquisando no projeto…'
  if (item.name === 'list_files') return target ? `Listando ${target}…` : 'Listando arquivos…'
  if (item.name.startsWith('propose_file_')) return target ? `Preparando alteração em ${target}…` : 'Preparando alteração…'
  if (item.name === 'run_command') return stringValue(args, 'program') ? `Executando ${stringValue(args, 'program')}…` : 'Executando comando…'
  if (item.name === 'get_git_status') return 'Verificando alterações do Git…'
  if (item.name === 'create_architecture_document') return target ? `Criando arquitetura em ${target}…` : 'Criando documento de arquitetura…'
  return `Executando ${item.name.replaceAll('_', ' ')}…`
}

function completedAction(name: string): string {
  const labels: Record<string, string> = {
    list_files: 'Listou arquivos', search_files: 'Pesquisou no projeto', read_file: 'Leu arquivo', open_file_in_editor: 'Abriu arquivo no editor',
    propose_file_change: 'Preparou alteração de arquivo', propose_file_patch: 'Preparou edição localizada',
    propose_file_delete: 'Preparou exclusão de arquivo', run_command: 'Executou comando',
    get_git_status: 'Verificou alterações do Git', create_architecture_document: 'Criou documento de arquitetura'
  }
  return labels[name] ?? name.replaceAll('_', ' ')
}

function statusIcon(status: RunStatus): string {
  if (status === 'failed') return '!'
  if (status === 'cancelled') return '×'
  if (status === 'completed') return '✓'
  return '●'
}

function statusLabel(status: ToolActivityItem['status']): string {
  return status === 'completed' ? 'concluído' : status === 'running' ? 'executando' : 'aguardando'
}

function contextLabel(value: unknown): string | undefined {
  const args = parseArguments(value)
  return stringValue(args, 'path') ?? stringValue(args, 'query') ?? stringValue(args, 'program')
}

function parseArguments(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch { return undefined }
}

function stringValue(value: Record<string, unknown> | undefined, key: string): string | undefined {
  return typeof value?.[key] === 'string' ? value[key] : undefined
}

function formatPayload(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return text.length > 1200 ? `${text.slice(0, 1200)}\n…` : text
}

function toolFailed(item: ToolActivityItem): boolean {
  return Boolean(item.result && typeof item.result === 'object' && 'ok' in item.result && item.result.ok === false)
}

function shortModel(model: string): string {
  if (model === 'openai/gpt-oss-120b') return '120B'
  if (model === 'openai/gpt-oss-20b') return '20B'
  return model.split('/').at(-1) ?? model
}
