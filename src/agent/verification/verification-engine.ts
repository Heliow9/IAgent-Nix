import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { runCommand } from '../tools/command-tool'

export interface VerificationResult { ok: boolean; checks: Array<{ name: string; command: string; ok: boolean; output: string }> }

export class VerificationEngine {
  constructor(private readonly getRoot: () => string) {}

  async run(signal: AbortSignal): Promise<VerificationResult> {
    const root = this.getRoot()
    const commands = await detectCommands(root)
    const checks: VerificationResult['checks'] = []
    for (const item of commands) {
      try {
        const result = await runCommand({ program: item.program, args: item.args, cwd: root, timeoutMs: 180_000 }, signal) as { stdout?: string; stderr?: string; exitCode?: number }
        const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().slice(-16_000)
        checks.push({ name: item.name, command: [item.program, ...item.args].join(' '), ok: (result.exitCode ?? 0) === 0, output })
      } catch (error) {
        checks.push({ name: item.name, command: [item.program, ...item.args].join(' '), ok: false, output: error instanceof Error ? error.message : String(error) })
      }
      if (!checks.at(-1)?.ok) break
    }
    if (!checks.length) checks.push({ name: 'workspace', command: 'none', ok: true, output: 'Nenhum comando de verificação padrão foi detectado.' })
    return { ok: checks.every((check) => check.ok), checks }
  }
}

async function detectCommands(root: string): Promise<Array<{ name: string; program: string; args: string[] }>> {
  try {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
    const scripts = pkg.scripts ?? {}
    const names = ['typecheck', 'lint', 'test', 'build'].filter((name) => scripts[name])
    return names.map((name) => ({ name, program: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['run', name, ...(name === 'test' ? ['--', '--run'] : [])] }))
  } catch { /* not a node project */ }
  try { await readFile(join(root, 'pyproject.toml'), 'utf8'); return [{ name: 'pytest', program: 'python', args: ['-m', 'pytest', '-q'] }] } catch { /* ignore */ }
  return []
}
