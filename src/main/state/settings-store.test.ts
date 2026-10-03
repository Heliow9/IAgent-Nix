import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { SettingsStore } from './settings-store'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('SettingsStore', () => {
  test('migrates legacy GPT-OSS model id and enables the Free Tier defaults', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nix-settings-'))
    directories.push(directory)
    const path = join(directory, 'nix.json')
    await writeFile(path, JSON.stringify({ fastModel: 'openai/gpt-oss-120', deepModel: 'openai/gpt-oss-120' }))

    const store = await SettingsStore.open(path)
    const value = store.get()

    expect(value.fastModel).toBe('openai/gpt-oss-120b')
    expect(value.deepModel).toBe('openai/gpt-oss-120b')
    expect(value.reasoningMode).toBe('auto')
    expect(value.groqFreeTierMode).toBe(true)
    expect(value.maxConcurrentRuns).toBe(1)
  })

  test('keeps Free Tier input and completion budgets below the protected request envelope', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nix-settings-'))
    directories.push(directory)
    const path = join(directory, 'nix.json')
    const store = await SettingsStore.open(path)

    const updated = await store.update({ contextTokenBudget: 99_000, maxCompletionTokens: 65_000, groqFreeTierMode: true })
    expect(updated.contextTokenBudget).toBeLessThanOrEqual(5_200)
    expect(updated.maxCompletionTokens).toBeLessThanOrEqual(3_000)
    expect(updated.contextTokenBudget + updated.maxCompletionTokens).toBeLessThanOrEqual(7_000)
  })

  test('caps concurrent runs to one while Free Tier mode is active', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nix-settings-'))
    directories.push(directory)
    const path = join(directory, 'nix.json')
    const store = await SettingsStore.open(path)

    const updated = await store.update({ maxConcurrentRuns: 6, groqFreeTierMode: true })
    expect(updated.maxConcurrentRuns).toBe(1)
    expect(JSON.parse(await readFile(path, 'utf8')).maxConcurrentRuns).toBe(1)
  })
})
