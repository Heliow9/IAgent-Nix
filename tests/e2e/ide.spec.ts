import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'

test.skip(process.env.RUN_E2E !== '1', 'Set RUN_E2E=1 after npm run build to run desktop tests')

let directories: string[] = []
let app: ElectronApplication | undefined

test.afterEach(async () => {
  await app?.close().catch(() => undefined)
  app = undefined
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test('previews, creates and opens a Node TypeScript project', async () => {
  const location = await mkdtemp(join(tmpdir(), 'groq-studio-e2e-create-'))
  directories.push(location)
  app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()

  await window.getByRole('button', { name: 'Novo projeto' }).click()
  await window.getByLabel('Nome').fill('Projeto E2E')
  await window.getByLabel('Local').fill(location)
  await window.getByRole('button', { name: /revisar criacao/i }).click()
  await expect(window.getByText('src/index.ts')).toBeVisible()
  await window.getByRole('button', { name: /criar e abrir/i }).click()

  await expect(window.getByText('EXPLORADOR', { exact: true })).toBeVisible()
  const manifest = JSON.parse(await readFile(join(location, 'projeto-e2e', 'package.json'), 'utf8')) as { name: string }
  expect(manifest.name).toBe('projeto-e2e')
})

test('edits and saves code, runs a terminal command and renders Mermaid', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'groq-studio-e2e-workspace-'))
  directories.push(workspace)
  await writeFile(join(workspace, 'note.txt'), 'before', 'utf8')
  await writeFile(join(workspace, 'architecture.mmd'), 'flowchart LR\n  UI --> Agent', 'utf8')
  app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()

  await window.getByLabel('Caminho do projeto').fill(workspace)
  await window.getByRole('button', { name: 'Abrir pasta' }).click()
  await window.getByRole('button', { name: /note\.txt/ }).click()
  await window.locator('.monaco-editor').click()
  await window.keyboard.press('Control+A')
  await window.keyboard.type('updated by e2e')
  await window.keyboard.press('Control+S')
  await expect.poll(() => readFile(join(workspace, 'note.txt'), 'utf8')).toBe('updated by e2e')

  await window.getByRole('button', { name: /architecture\.mmd/ }).click()
  await expect(window.locator('.mermaid-preview svg')).toBeVisible()

  const terminalInput = window.locator('.xterm-helper-textarea')
  await terminalInput.focus()
  await window.keyboard.insertText("node -e \"require('fs').writeFileSync('terminal-ok.txt','ok')\"")
  await window.keyboard.press('Enter')
  await expect.poll(() => readFile(join(workspace, 'terminal-ok.txt'), 'utf8').catch(() => ''), { timeout: 10_000 }).toBe('ok')
})
