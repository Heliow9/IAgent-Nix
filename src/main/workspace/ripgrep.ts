import { spawn } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

export interface SearchMatch {
  path: string
  line: number
  column: number
  preview: string
}

export interface SearchOptions {
  maxResults?: number
  useRipgrep?: boolean
}

const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'out'])
const SECRET_NAMES = /^(\.env(?:\..*)?|id_(?:rsa|ed25519)|.*\.(?:pem|key))$/i

export async function searchWorkspace(root: string, query: string, options: SearchOptions = {}): Promise<SearchMatch[]> {
  const maxResults = options.maxResults ?? 100
  if (!query || maxResults <= 0) return []
  if (options.useRipgrep !== false) {
    try {
      return await searchWithRipgrep(root, query, maxResults)
    } catch (error) {
      if (!isMissingExecutable(error)) throw error
    }
  }
  return searchWithJavaScript(root, query, maxResults)
}

async function searchWithRipgrep(root: string, query: string, maxResults: number): Promise<SearchMatch[]> {
  return new Promise((resolve, reject) => {
    const child = spawn('rg', [
      '--json', '--line-number', '--column', '--fixed-strings',
      '--glob', '!**/.env*', '--glob', '!**/*.pem', '--glob', '!**/*.key',
      '--glob', '!**/node_modules/**', query, '.'
    ], { cwd: root, windowsHide: true })
    const matches: SearchMatch[] = []
    let pending = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      pending += chunk
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) {
        if (!line || matches.length >= maxResults) continue
        const message = JSON.parse(line) as {
          type: string
          data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string }; submatches?: Array<{ start: number }> }
        }
        if (message.type !== 'match' || !message.data?.path?.text) continue
        matches.push({
          path: message.data.path.text.replaceAll('\\', '/').replace(/^\.\//, ''),
          line: message.data.line_number ?? 1,
          column: (message.data.submatches?.[0]?.start ?? 0) + 1,
          preview: (message.data.lines?.text ?? '').trimEnd()
        })
      }
      if (matches.length >= maxResults) child.kill()
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0 || code === 1 || matches.length >= maxResults) resolve(matches.slice(0, maxResults))
      else reject(new Error(stderr || `ripgrep exited with code ${code}`))
    })
  })
}

async function searchWithJavaScript(root: string, query: string, maxResults: number): Promise<SearchMatch[]> {
  const matches: SearchMatch[] = []
  const visit = async (directory: string): Promise<void> => {
    if (matches.length >= maxResults) return
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (matches.length >= maxResults) return
      if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue
      if (SECRET_NAMES.test(entry.name)) continue
      const absolutePath = join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(absolutePath)
        continue
      }
      if (!entry.isFile() || (await stat(absolutePath)).size > 1_000_000) continue
      const buffer = await readFile(absolutePath)
      if (buffer.includes(0)) continue
      buffer.toString('utf8').split(/\r?\n/).forEach((line, index) => {
        if (matches.length >= maxResults) return
        const column = line.indexOf(query)
        if (column >= 0) matches.push({
          path: relative(root, absolutePath).replaceAll('\\', '/'),
          line: index + 1,
          column: column + 1,
          preview: line
        })
      })
    }
  }
  await visit(root)
  return matches
}

function isMissingExecutable(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
