# NIX 0.2.2 — correção final dos parâmetros implícitos `any`

Esta revisão corrige os 6 erros TS7006 encontrados após a versão 0.2.1.

Arquivos ajustados:
- `src/renderer/src/components/editor/EditorArea.test.tsx`
- `src/renderer/src/components/workspace/FileTree.test.tsx`
- `src/renderer/src/store/ide-store.test.ts`

Alterações:
- `root` foi tipado explicitamente como `string` nos mocks de `workspace.open`.
- `runId` foi tipado explicitamente como `string` nos mocks de `agent.resume`.

A versão do pacote foi elevada para `0.2.2`.
