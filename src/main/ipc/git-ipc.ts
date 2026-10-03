import { ipcMain } from 'electron'
import { z } from 'zod'
import type { GitStatus } from '../../shared/contracts'
import { runCommand } from '../../agent/tools/command-tool'
import type { WorkspaceAccess } from './workspace-ipc'

export function registerGitIpc(access: WorkspaceAccess): void {
  const cwd = (): string => { if (!access.current) throw new Error('No workspace is open'); return access.current.root }
  const run = (args: string[]) => runCommand({ program: 'git', args, cwd: cwd(), timeoutMs: 60_000 }, new AbortController().signal)
  ipcMain.handle('git:status', async (): Promise<GitStatus> => {
    const branchRaw = await run(['status', '--porcelain=v2', '--branch'])
    const lines = String((branchRaw as { stdout?: string }).stdout ?? branchRaw).split(/\r?\n/)
    let branch = 'detached'; let ahead = 0; let behind = 0
    const files: GitStatus['files'] = []
    for (const line of lines) {
      if (line.startsWith('# branch.head ')) branch = line.slice(14).trim()
      else if (line.startsWith('# branch.ab ')) { const m = /\+(\d+)\s+-(\d+)/.exec(line); ahead = Number(m?.[1] ?? 0); behind = Number(m?.[2] ?? 0) }
      else if (line.startsWith('1 ') || line.startsWith('2 ')) {
        const parts = line.split(' '); const xy = parts[1] ?? '..'; const path = line.startsWith('2 ') ? (line.split('\t').at(-1) ?? '') : (parts.at(-1) ?? '')
        files.push({ path, index: xy[0] ?? '.', worktree: xy[1] ?? '.' })
      } else if (line.startsWith('? ')) files.push({ path: line.slice(2), index: '?', worktree: '?' })
    }
    return { branch, ahead, behind, files, clean: files.length === 0 }
  })
  ipcMain.handle('git:diff', async (_e, payload) => {
    const input = z.object({ path: z.string().optional(), staged: z.boolean().default(false) }).parse(payload ?? {})
    const args = ['diff', ...(input.staged ? ['--cached'] : []), '--', ...(input.path ? [input.path] : [])]
    const result = await run(args); return String((result as { stdout?: string }).stdout ?? result)
  })
  ipcMain.handle('git:stage', async (_e, payload) => { const { paths } = z.object({ paths: z.array(z.string().min(1)).min(1) }).parse(payload); await run(['add', '--', ...paths]) })
  ipcMain.handle('git:unstage', async (_e, payload) => { const { paths } = z.object({ paths: z.array(z.string().min(1)).min(1) }).parse(payload); await run(['restore', '--staged', '--', ...paths]) })
  ipcMain.handle('git:commit', async (_e, payload) => { const { message } = z.object({ message: z.string().min(1).max(500) }).parse(payload); const result = await run(['commit', '-m', message]); return String((result as { stdout?: string }).stdout ?? result) })
  ipcMain.handle('git:branches', async () => { const result = await run(['branch', '--format=%(HEAD)|%(refname:short)']); return String((result as { stdout?: string }).stdout ?? result).split(/\r?\n/).filter(Boolean).map((line) => { const [head, name] = line.split('|'); return { name, current: head.trim() === '*' } }) })
  ipcMain.handle('git:checkout', async (_e, payload) => { const { branch } = z.object({ branch: z.string().min(1) }).parse(payload); await run(['checkout', branch]) })
}
