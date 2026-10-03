export interface ImportToken {
  specifier: string
  startColumn: number
  endColumn: number
}

const STATIC_IMPORT = /\b(?:import|export)\s+(?:(?:[^'"\n]*?)\s+from\s+)?(['"])([^'"\n]+)\1/g
const DYNAMIC_IMPORT = /\b(?:import|require)\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g

export function importTokensInLine(line: string): ImportToken[] {
  return [...tokensFor(line, STATIC_IMPORT), ...tokensFor(line, DYNAMIC_IMPORT)]
    .sort((left, right) => left.startColumn - right.startColumn)
}

export function importSpecifierAtPosition(line: string, column: number): string | undefined {
  return importTokensInLine(line).find((token) => column >= token.startColumn && column <= token.endColumn)?.specifier
}

function tokensFor(line: string, expression: RegExp): ImportToken[] {
  const tokens: ImportToken[] = []
  expression.lastIndex = 0
  for (let match = expression.exec(line); match; match = expression.exec(line)) {
    const specifier = match[2]
    const offset = match[0].lastIndexOf(specifier)
    if (offset < 0) continue
    const startColumn = match.index + offset + 1
    tokens.push({ specifier, startColumn, endColumn: startColumn + specifier.length })
  }
  return tokens
}
