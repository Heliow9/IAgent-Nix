import { describe, expect, test } from 'vitest'

import { importSpecifierAtPosition, importTokensInLine } from './import-navigation'

describe('import navigation parsing', () => {
  test.each([
    ["import { Button } from './components/Button'", './components/Button'],
    ["import './styles.css'", './styles.css'],
    ["export { value } from '../value'", '../value'],
    ["const lazy = import('./Lazy')", './Lazy'],
    ["const config = require('./config')", './config']
  ])('recognizes %s', (line, expected) => {
    expect(importTokensInLine(line).map((item) => item.specifier)).toContain(expected)
  })

  test('returns a specifier only when the click is inside the import path', () => {
    const line = "import { App } from './App'"
    const token = importTokensInLine(line)[0]
    expect(importSpecifierAtPosition(line, token.startColumn + 2)).toBe('./App')
    expect(importSpecifierAtPosition(line, 2)).toBeUndefined()
  })
})
