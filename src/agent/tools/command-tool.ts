import { spawn } from 'node:child_process'

export interface CommandInput {
  program: string
  args?: string[]
  cwd: string
  timeoutMs?: number
}

export async function runCommand(input: CommandInput, signal: AbortSignal): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const useShell = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(input.program)
    const child = spawn(input.program, input.args ?? [], { cwd: input.cwd, windowsHide: true, shell: useShell })
    let stdout = ''
    let stderr = ''
    const limit = 200_000
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout = (stdout + chunk).slice(-limit) })
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-limit) })
    const stop = (): void => { child.kill() }
    signal.addEventListener('abort', stop, { once: true })
    const timer = setTimeout(stop, input.timeoutMs ?? 120_000)
    child.on('error', reject)
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', stop)
      if (signal.aborted) reject(Object.assign(new Error('Command cancelled'), { name: 'AbortError' }))
      else resolve({ exitCode, stdout, stderr })
    })
  })
}
