import { describe, expect, test } from 'vitest'
import { languageForPath } from './languages'

describe('languageForPath', () => {
  test.each([
    ['src/LoginPage.tsx', 'typescript'],
    ['src/index.ts', 'typescript'],
    ['src/module.mts', 'typescript'],
    ['src/module.cts', 'typescript'],
    ['src/App.jsx', 'javascript'],
    ['src/index.js', 'javascript'],
    ['src/module.mjs', 'javascript'],
    ['src/module.cjs', 'javascript'],
    ['worker.py', 'python'],
    ['schema.sql', 'sql'],
    ['README.md', 'markdown']
  ])('maps %s to %s', (path, expected) => {
    expect(languageForPath(path)).toBe(expected)
  })
})
