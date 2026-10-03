import { describe, expect, test, vi } from 'vitest'
import { configureMonacoLanguages } from './monaco-language-config'

describe('configureMonacoLanguages', () => {
  test('keeps syntax validation but disables standalone semantic false positives', () => {
    const tsDiagnostics = vi.fn()
    const jsDiagnostics = vi.fn()
    const tsCompiler = vi.fn()
    const jsCompiler = vi.fn()
    const tsSync = vi.fn()
    const jsSync = vi.fn()
    const monaco = {
      languages: {
        typescript: {
          ScriptTarget: { ES2022: 99 },
          ModuleKind: { ESNext: 99 },
          ModuleResolutionKind: { NodeJs: 99 },
          JsxEmit: { ReactJSX: 99 },
          typescriptDefaults: { setCompilerOptions: tsCompiler, setDiagnosticsOptions: tsDiagnostics, setEagerModelSync: tsSync },
          javascriptDefaults: { setCompilerOptions: jsCompiler, setDiagnosticsOptions: jsDiagnostics, setEagerModelSync: jsSync }
        }
      }
    }

    configureMonacoLanguages(monaco as never)

    expect(tsDiagnostics).toHaveBeenCalledWith({ noSyntaxValidation: false, noSemanticValidation: true })
    expect(jsDiagnostics).toHaveBeenCalledWith({ noSyntaxValidation: false, noSemanticValidation: true })
    expect(tsCompiler).toHaveBeenCalled()
    expect(jsCompiler).toHaveBeenCalled()
  })
})
