import type * as Monaco from 'monaco-editor'

type MonacoApi = typeof Monaco

let configured = false

/**
 * Monaco runs its own browser TypeScript worker. In the Electron renderer it
 * cannot see the real workspace filesystem/node_modules, so semantic module
 * resolution produces false "cannot find module" diagnostics for valid imports.
 *
 * Keep syntax diagnostics enabled, but leave project semantic diagnostics to
 * the real workspace toolchain (tsc/eslint/etc.) executed by NIX.
 */
export function configureMonacoLanguages(monaco: MonacoApi): void {
  if (configured) return
  configured = true

  const ts = monaco.languages.typescript
  const compilerOptions: Monaco.languages.typescript.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    jsx: ts.JsxEmit.ReactJSX,
    allowJs: true,
    checkJs: false,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    resolveJsonModule: true,
    allowNonTsExtensions: true,
    isolatedModules: true
  }

  ts.typescriptDefaults.setCompilerOptions(compilerOptions)
  ts.javascriptDefaults.setCompilerOptions(compilerOptions)

  ts.typescriptDefaults.setDiagnosticsOptions({
    noSyntaxValidation: false,
    noSemanticValidation: true
  })
  ts.javascriptDefaults.setDiagnosticsOptions({
    noSyntaxValidation: false,
    noSemanticValidation: true
  })

  ts.typescriptDefaults.setEagerModelSync(true)
  ts.javascriptDefaults.setEagerModelSync(true)
}
