import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { WorkspaceError, WorkspaceService } from './workspace-service'

describe('WorkspaceService', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'groq-ide-workspace-'))
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'index.ts'), 'first\nsecond\nthird\n', 'utf8')
    await writeFile(join(root, '.env'), 'GROQ_API_KEY=secret', 'utf8')
  })

  afterEach(async () => {
    const { rm } = await import('node:fs/promises')
    await rm(root, { recursive: true, force: true })
  })

  test('lists relative entries and filters secret files', async () => {
    const workspace = await WorkspaceService.open(root)

    const entries = await workspace.list('')

    expect(entries).toEqual([
      { name: 'src', path: 'src', kind: 'directory' }
    ])
    expect(entries.every((entry) => !isAbsolute(entry.path))).toBe(true)
  })

  test('reads a requested line range with a stable content hash', async () => {
    const workspace = await WorkspaceService.open(root)

    const result = await workspace.readText('src/index.ts', { startLine: 2, endLine: 3 })

    expect(result.content).toBe('second\nthird')
    expect(result.totalLines).toBe(4)
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/)
  })

  test.each(['../outside.txt', join(tmpdir(), 'absolute.txt')])(
    'rejects path outside the workspace: %s',
    async (unsafePath) => {
      const workspace = await WorkspaceService.open(root)

      await expect(workspace.readText(unsafePath)).rejects.toMatchObject({
        code: 'PATH_OUTSIDE_WORKSPACE'
      })
    }
  )

  test('rejects secret files even when explicitly requested', async () => {
    const workspace = await WorkspaceService.open(root)

    await expect(workspace.readText('.env')).rejects.toMatchObject({ code: 'SECRET_FILE' })
  })

  test('rejects files larger than the configured byte limit', async () => {
    const workspace = await WorkspaceService.open(root, { maxReadBytes: 5 })

    await expect(workspace.readText('src/index.ts')).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE'
    })
  })

  test('writes atomically and rejects a stale expected hash without changing the file', async () => {
    const workspace = await WorkspaceService.open(root)
    const original = await workspace.readText('src/index.ts')

    await workspace.writeTextAtomic('src/index.ts', 'updated\n', original.hash)
    await expect(workspace.writeTextAtomic('src/index.ts', 'stale\n', original.hash)).rejects.toMatchObject({
      code: 'CONTENT_CONFLICT'
    })

    expect(await readFile(join(root, 'src', 'index.ts'), 'utf8')).toBe('updated\n')
  })

  test('rejects a directory junction that escapes the workspace', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'groq-ide-outside-'))
    await writeFile(join(outside, 'secret.txt'), 'outside', 'utf8')
    await symlink(outside, join(root, 'linked-outside'), 'junction')
    const workspace = await WorkspaceService.open(root)

    try {
      await expect(workspace.readText('linked-outside/secret.txt')).rejects.toMatchObject({
        code: 'PATH_OUTSIDE_WORKSPACE'
      })
    } finally {
      const { rm } = await import('node:fs/promises')
      await rm(outside, { recursive: true, force: true })
    }
  })

  test('creates and removes a folder inside the workspace', async () => {
    const workspace = await WorkspaceService.open(root)

    await workspace.createFolder('generated/nested')
    expect(await workspace.list('generated')).toEqual([
      { name: 'nested', path: 'generated/nested', kind: 'directory' }
    ])

    await workspace.remove('generated')
    expect(await workspace.list('')).toEqual([
      { name: 'src', path: 'src', kind: 'directory' }
    ])
  })

  test('searches with the JavaScript fallback while excluding secrets and respecting limits', async () => {
    await writeFile(join(root, 'src', 'other.ts'), 'needle one\nneedle two\n', 'utf8')
    await writeFile(join(root, '.env'), 'needle secret', 'utf8')
    const workspace = await WorkspaceService.open(root)

    const matches = await workspace.search('needle', { useRipgrep: false, maxResults: 1 })

    expect(matches).toEqual([
      { path: 'src/other.ts', line: 1, column: 1, preview: 'needle one' }
    ])
  })

  test('searches inside a nested project without losing matches to global result limits', async () => {
    await mkdir(join(root, 'apps', 'dashboard'), { recursive: true })
    await mkdir(join(root, 'apps', 'mobile'), { recursive: true })
    await writeFile(join(root, 'apps', 'dashboard', 'Login.tsx'), 'login dashboard\n', 'utf8')
    await writeFile(join(root, 'apps', 'mobile', 'Login.tsx'), 'login mobile\n', 'utf8')
    const workspace = await WorkspaceService.open(root)

    const matches = await workspace.search('login', { useRipgrep: false, path: 'apps/dashboard', maxResults: 10 })

    expect(matches).toEqual([
      { path: 'apps/dashboard/Login.tsx', line: 1, column: 1, preview: 'login dashboard' }
    ])
  })

  test('resolves relative imports, index modules and common src aliases', async () => {
    await mkdir(join(root, 'src', 'components'), { recursive: true })
    await writeFile(join(root, 'src', 'components', 'Button.tsx'), 'export const Button = () => null\n', 'utf8')
    await mkdir(join(root, 'src', 'feature'), { recursive: true })
    await writeFile(join(root, 'src', 'feature', 'index.ts'), 'export const feature = true\n', 'utf8')
    const workspace = await WorkspaceService.open(root)

    await expect(workspace.resolveImport('src/index.ts', './components/Button')).resolves.toEqual({ kind: 'workspace', path: 'src/components/Button.tsx' })
    await expect(workspace.resolveImport('src/index.ts', './feature')).resolves.toEqual({ kind: 'workspace', path: 'src/feature/index.ts' })
    await expect(workspace.resolveImport('src/index.ts', '@/components/Button')).resolves.toEqual({ kind: 'workspace', path: 'src/components/Button.tsx' })
    await expect(workspace.resolveImport('src/index.ts', 'react')).resolves.toEqual({ kind: 'external' })
    await expect(workspace.resolveImport('src/index.ts', './missing')).resolves.toEqual({ kind: 'unresolved' })
  })

  test('uses structured workspace errors', () => {
    const error = new WorkspaceError('NOT_OPEN', 'No workspace is open')

    expect(error).toMatchObject({ code: 'NOT_OPEN', message: 'No workspace is open' })
  })
})
