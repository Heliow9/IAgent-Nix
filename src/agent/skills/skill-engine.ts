import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

import type { SkillInfo } from '../../shared/contracts'

export interface LoadedSkill extends SkillInfo { instructions: string; triggers: string[] }

const BUILTIN: LoadedSkill[] = [
  skill('brainstorming', 'Brainstorming', 'Clarifica requisitos, restrições e alternativas antes de mudanças amplas.', ['criar','feature','arquitetura','novo','design'], 'Antes de implementar algo amplo, explicite objetivo, restrições, riscos e uma abordagem mínima. Evite expandir escopo sem necessidade.'),
  skill('planning', 'Planning', 'Quebra trabalho complexo em etapas verificáveis.', ['implementar','refatorar','migrar','integrar','tudo'], 'Para tarefas complexas, formule um plano curto em etapas, identifique dependências e execute na ordem. Atualize o plano quando surgir evidência nova.'),
  skill('systematic-debugging', 'Systematic Debugging', 'Investiga causa raiz antes de corrigir sintomas.', ['erro','bug','falha','não funciona','nao funciona','exception','stack'], 'Em debugging: reproduza, colete evidências, rastreie o fluxo, formule hipótese, faça a menor correção e valide regressões. Não chute causas.'),
  skill('tdd', 'Test Driven Development', 'Prefere teste reproduzindo o problema antes da correção quando viável.', ['teste','bug','regressão','regressao','corrigir'], 'Quando viável, crie ou ajuste um teste que falhe pelo motivo correto antes da correção e confirme que passa depois.'),
  skill('code-review', 'Code Review', 'Revisa diff por bugs, regressões e segurança.', ['revisar','review','pr','refatorar','implementar'], 'Depois de alterar código, revise o diff procurando erros lógicos, APIs quebradas, tratamento de erro, segurança e mudanças acidentais.'),
  skill('verification', 'Verification Before Completion', 'Exige evidência de typecheck/test/build antes de declarar conclusão.', ['implementar','corrigir','concluir','pronto','build'], 'Não declare concluído sem executar verificações relevantes. Informe exatamente o que rodou e qualquer limitação.'),
  skill('workspace-intelligence', 'Workspace Intelligence', 'Usa índice de símbolos/imports antes de leituras repetitivas.', ['onde','arquivo','import','função','funcao','classe','fluxo'], 'Use workspace_overview/search_symbols/related_files para localizar código e reduzir leituras repetidas.'),
  skill('subagent-review', 'Subagent Review', 'Delega análise independente em tarefas de maior risco.', ['arquitetura','complexo','grande','migrar','segurança','seguranca'], 'Em tarefas complexas, use delegate_task para obter uma segunda análise de planner/reviewer e confronte com a evidência do workspace.')
]

function skill(id: string, name: string, description: string, triggers: string[], instructions: string): LoadedSkill {
  return { id, name, description, source: 'builtin', enabled: true, triggers, instructions }
}

export class SkillEngine {
  private loaded: LoadedSkill[] = [...BUILTIN]
  private workspaceRoot?: string

  setWorkspace(root: string): void { this.workspaceRoot = root }

  async reload(): Promise<SkillInfo[]> {
    const external: LoadedSkill[] = []
    const dirs = [
      this.workspaceRoot ? join(this.workspaceRoot, '.nix', 'skills') : undefined,
      this.workspaceRoot ? join(this.workspaceRoot, '.superpowers', 'skills') : undefined,
      process.env.NIX_SUPERPOWERS_DIR,
      join(homedir(), '.config', 'nix', 'skills')
    ].filter((value): value is string => Boolean(value))
    for (const dir of dirs) external.push(...await loadDirectory(dir, this.workspaceRoot && resolve(dir).startsWith(resolve(this.workspaceRoot)) ? 'workspace' : 'external'))
    const byId = new Map<string, LoadedSkill>()
    for (const item of [...BUILTIN, ...external]) byId.set(item.id, item)
    this.loaded = [...byId.values()]
    return this.list()
  }

  list(): SkillInfo[] { return this.loaded.map(({ instructions: _i, triggers: _t, ...info }) => info) }

  select(prompt: string, enabled = true): LoadedSkill[] {
    if (!enabled) return []
    const lower = prompt.toLowerCase()
    const selected = this.loaded.filter((item) => item.enabled && item.triggers.some((trigger) => lower.includes(trigger)))
    const verification = this.loaded.find((item) => item.id === 'verification')
    if (verification && !selected.includes(verification)) selected.push(verification)
    return selected.slice(0, 6)
  }

  promptFragment(prompt: string, enabled = true): string {
    const selected = this.select(prompt, enabled)
    if (!selected.length) return ''
    return ['Skills NIX ativas nesta tarefa:', ...selected.map((item) => `- ${item.name}: ${item.instructions}`)].join('\n')
  }
}

async function loadDirectory(dir: string, source: 'workspace' | 'external'): Promise<LoadedSkill[]> {
  const result: LoadedSkill[] = []
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return result }
  for (const entry of entries) {
    if (entry.isDirectory()) { result.push(...await loadDirectory(join(dir, entry.name), source)); continue }
    if (!entry.name.toLowerCase().endsWith('.md')) continue
    try {
      const text = await readFile(join(dir, entry.name), 'utf8')
      const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() || basename(entry.name, '.md')
      const triggerLine = /^triggers:\s*(.+)$/im.exec(text)?.[1]
      result.push({ id: `${source}:${basename(entry.name, '.md')}`, name: title, description: text.split(/\r?\n/).find((line) => line.trim() && !line.startsWith('#') && !/^triggers:/i.test(line))?.trim().slice(0, 180) || title, source, enabled: true, triggers: triggerLine ? triggerLine.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) : [title.toLowerCase()], instructions: text.slice(0, 8_000) })
    } catch { /* malformed skill is ignored */ }
  }
  return result
}
