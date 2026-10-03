import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path'

import type { ImportResolution, WorkspaceEntry } from '../../shared/contracts'
import { searchWorkspace, type SearchMatch, type SearchOptions } from './ripgrep'

export type WorkspaceErrorCode =
  | 'INVALID_WORKSPACE'
  | 'PATH_OUTSIDE_WORKSPACE'
  | 'SECRET_FILE'
  | 'FILE_TOO_LARGE'
  | 'BINARY_FILE'
  | 'CONTENT_CONFLICT'
  | 'NOT_OPEN'

export class WorkspaceError extends Error {
  constructor(public readonly code: WorkspaceErrorCode, message: string) {
    super(message)
    this.name = 'WorkspaceError'
  }
}

export interface WorkspaceServiceOptions {
  maxReadBytes?: number
  maxListEntries?: number
}

export interface ReadTextRange {
  startLine?: number
  endLine?: number
}

export interface ReadTextResult {
  content: string
  hash: string
  totalLines: number
}

const SECRET_NAMES = /^(\.env(?:\..*)?|id_(?:rsa|ed25519)|.*\.(?:pem|key|p12|pfx))$/i

export class WorkspaceService {
  readonly root: string
  private readonly maxReadBytes: number
  private readonly maxListEntries: number

  private constructor(root: string, options: WorkspaceServiceOptions) {
    this.root = root
    this.maxReadBytes = options.maxReadBytes ?? 1_000_000
    this.maxListEntries = options.maxListEntries ?? 2_000
  }

  static async open(root: string, options: WorkspaceServiceOptions = {}): Promise<WorkspaceService> {
    const canonical = await realpath(root).catch(() => {
      throw new WorkspaceError('INVALID_WORKSPACE', 'The selected workspace does not exist')
    })
    const rootStat = await stat(canonical)
    if (!rootStat.isDirectory()) throw new WorkspaceError('INVALID_WORKSPACE', 'The workspace must be a directory')
    return new WorkspaceService(canonical, options)
  }

  async list(relativePath = ''): Promise<WorkspaceEntry[]> {
    const directory = await this.resolveExisting(relativePath, true)
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter((entry) => !isSecretName(entry.name))
      .slice(0, this.maxListEntries)
      .map((entry) => ({
        name: entry.name,
        path: toWorkspacePath(relative(this.root, resolve(directory, entry.name))),
        kind: entry.isDirectory() ? 'directory' as const : 'file' as const
      }))
      .sort((left, right) => {
        if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
        return left.name.localeCompare(right.name)
      })
  }

  async readText(relativePath: string, range: ReadTextRange = {}): Promise<ReadTextResult> {
    this.assertNotSecret(relativePath)
    const file = await this.resolveExisting(relativePath)
    const fileStat = await stat(file)
    if (fileStat.size > this.maxReadBytes) {
      throw new WorkspaceError('FILE_TOO_LARGE', `File exceeds ${this.maxReadBytes} bytes`)
    }
    const buffer = await readFile(file)
    if (buffer.includes(0)) throw new WorkspaceError('BINARY_FILE', 'Binary files cannot be opened as text')
    const fullContent = buffer.toString('utf8')
    const lines = fullContent.split(/\r?\n/)
    const start = Math.max(1, range.startLine ?? 1)
    const end = Math.min(lines.length, range.endLine ?? lines.length)
    return {
      content: lines.slice(start - 1, end).join('\n'),
      hash: hashBuffer(buffer),
      totalLines: lines.length
    }
  }

  async writeTextAtomic(relativePath: string, content: string, expectedHash?: string): Promise<{ hash: string }> {
    this.assertNotSecret(relativePath)
    const target = await this.resolveForWrite(relativePath)
    if (expectedHash !== undefined) {
      const current = await readFile(target).catch(() => undefined)
      if (!current || hashBuffer(current) !== expectedHash) {
        throw new WorkspaceError('CONTENT_CONFLICT', 'O arquivo foi alterado no disco depois de ser aberto. Recarregue antes de salvar novamente.')
      }
    }
    await mkdir(dirname(target), { recursive: true })
    await this.assertCanonicalInside(dirname(target))
    const temporary = resolve(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, content, 'utf8')
      await rename(temporary, target)
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
    return { hash: hashBuffer(Buffer.from(content, 'utf8')) }
  }

  async remove(relativePath: string): Promise<void> {
    this.assertNotSecret(relativePath)
    const target = await this.resolveExisting(relativePath)
    if (target === this.root) throw new WorkspaceError('PATH_OUTSIDE_WORKSPACE', 'Cannot remove the workspace root')
    await rm(target, { recursive: true, force: false })
  }

  async search(query: string, options: SearchOptions & { path?: string } = {}): Promise<SearchMatch[]> {
    const requestedPath = options.path?.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
    if (!requestedPath || requestedPath === '.') return searchWorkspace(this.root, query, options)
    const searchRoot = await this.resolveExisting(requestedPath, true)
    if (!(await stat(searchRoot)).isDirectory()) throw new WorkspaceError('INVALID_WORKSPACE', 'Search path must be a directory')
    const matches = await searchWorkspace(searchRoot, query, options)
    return matches.map((match) => ({ ...match, path: `${requestedPath}/${match.path}`.replace(/\/+/g, '/') }))
  }

  async resolveImport(fromPath: string, specifier: string): Promise<ImportResolution> {
    await this.resolveExisting(fromPath)
    const cleaned = specifier.trim().replace(/[?#].*$/, '')
    if (!cleaned) return { kind: 'unresolved' }

    let relativeBase: string
    if (cleaned.startsWith('./') || cleaned.startsWith('../')) {
      const hostCandidate = resolve(this.root, dirname(fromPath), cleaned)
      relativeBase = toWorkspacePath(relative(this.root, hostCandidate))
    } else if (cleaned.startsWith('@/') || cleaned.startsWith('~/')) {
      relativeBase = `src/${cleaned.slice(2)}`
    } else if (cleaned.startsWith('/')) {
      relativeBase = cleaned.slice(1)
    } else {
      return { kind: 'external' }
    }

    const resolved = await this.firstExistingImportCandidate(relativeBase)
    return resolved ? { kind: 'workspace', path: resolved } : { kind: 'unresolved' }
  }

  async createFolder(relativePath: string): Promise<void> {
    const target = await this.resolveForWrite(relativePath)
    await mkdir(target, { recursive: true })
    await this.assertCanonicalInside(target)
  }

  private async resolveExisting(relativePath: string, allowRoot = false): Promise<string> {
    const lexical = this.resolveLexical(relativePath, allowRoot)
    const canonical = await realpath(lexical)
    this.assertInside(canonical)
    return canonical
  }

  private async resolveForWrite(relativePath: string): Promise<string> {
    const lexical = this.resolveLexical(relativePath, false)
    let existing = dirname(lexical)
    while (!(await exists(existing))) {
      const parent = dirname(existing)
      if (parent === existing) break
      existing = parent
    }
    await this.assertCanonicalInside(existing)
    if (await exists(lexical)) await this.assertCanonicalInside(lexical)
    return lexical
  }

  private async firstExistingImportCandidate(relativeBase: string): Promise<string | undefined> {
    const normalized = toWorkspacePath(relativeBase).replace(/^\.\//, '')
    const extension = extname(normalized).toLowerCase()
    const candidates = new Set<string>([normalized])
    const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.scss', '.sass', '.less', '.md', '.mmd']

    if (!extension) {
      for (const candidateExtension of sourceExtensions) candidates.add(`${normalized}${candidateExtension}`)
      for (const candidateExtension of sourceExtensions) candidates.add(`${normalized}/index${candidateExtension}`)
    } else if (extension === '.js' || extension === '.jsx' || extension === '.mjs' || extension === '.cjs') {
      const withoutExtension = normalized.slice(0, -extension.length)
      for (const candidateExtension of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) candidates.add(`${withoutExtension}${candidateExtension}`)
    }

    for (const candidate of candidates) {
      try {
        this.assertNotSecret(candidate)
        const target = await this.resolveExisting(candidate)
        if ((await stat(target)).isFile()) return toWorkspacePath(relative(this.root, target))
      } catch (error) {
        if (error instanceof WorkspaceError && (error.code === 'PATH_OUTSIDE_WORKSPACE' || error.code === 'SECRET_FILE')) continue
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue
        throw error
      }
    }
    return undefined
  }

  private resolveLexical(relativePath: string, allowRoot: boolean): string {
    if (isAbsolute(relativePath) || relativePath.includes('\0')) {
      throw new WorkspaceError('PATH_OUTSIDE_WORKSPACE', 'Path must be relative to the workspace')
    }
    const target = resolve(this.root, relativePath || '.')
    this.assertInside(target)
    if (!allowRoot && target === this.root) {
      throw new WorkspaceError('PATH_OUTSIDE_WORKSPACE', 'Operation requires a path inside the workspace')
    }
    return target
  }

  private async assertCanonicalInside(path: string): Promise<void> {
    const canonical = await realpath(path)
    this.assertInside(canonical)
  }

  private assertInside(path: string): void {
    const fromRoot = relative(this.root, path)
    if (fromRoot === '') return
    if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
      throw new WorkspaceError('PATH_OUTSIDE_WORKSPACE', 'Path escapes the active workspace')
    }
  }

  private assertNotSecret(relativePath: string): void {
    if (relativePath.split(/[\\/]/).some(isSecretName)) {
      throw new WorkspaceError('SECRET_FILE', 'Secret files require an explicit out-of-band action')
    }
  }
}

function isSecretName(name: string): boolean {
  return SECRET_NAMES.test(name)
}

function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

function toWorkspacePath(path: string): string {
  return path.replaceAll('\\', '/')
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}
