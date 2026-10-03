# Groq Desktop IDE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar uma IDE Electron local que cria e abre projetos, edita codigo, executa terminal, conversa com um agente Groq, gera diagramas Mermaid e aplica mudancas por um fluxo seguro de diff e aprovacao.

**Architecture:** O renderer React nao recebe acesso direto ao Node; o preload oferece uma API IPC tipada e o processo principal concentra filesystem, PTY, persistencia e agent core. O agent core depende de interfaces de provider e ferramentas, permitindo testes sem rede e mantendo Groq substituivel.

**Tech Stack:** Electron, React, TypeScript, electron-vite, Monaco Editor, xterm.js, node-pty, Mermaid, Zustand, Zod, Groq SDK, Vitest, Testing Library e Playwright.

**Spec:** `docs/superpowers/specs/2026-10-03-groq-desktop-ide-design.md`

## Global Constraints

- O MVP suporta Windows, usuario unico e uma maquina.
- `npm install` e `npm run dev` devem abrir a IDE.
- O Groq e o unico provider habilitado, mas fica atras de uma interface interna.
- O renderer usa `contextIsolation: true`, `nodeIntegration: false` e somente IPC validado.
- Toda resolucao de caminho precisa permanecer dentro do workspace real, inclusive apos symlinks ou junctions.
- `.env`, chaves privadas e credenciais ficam fora do contexto automatico.
- O modo de permissao padrao e `ask`; exclusoes e comandos perigosos sempre exigem aprovacao.
- Escritas usam arquivo temporario e rename atomico; conflitos de conteudo impedem aplicacao.
- Cada execucao do agente tem no maximo 20 iteracoes e pode ser cancelada.
- Testes padrao nao acessam Groq; acesso real ocorre apenas em smoke test explicitamente habilitado.

## Review Focus

- Symlink ou junction apontando para fora do workspace deve ser rejeitado por `WorkspaceService`; coberto no Task 2.
- Tool call Groq desconhecida ou com JSON invalido nao pode executar efeito colateral; coberto no Task 5.
- Arquivo alterado depois da geracao do diff deve produzir conflito e preservar o arquivo atual; coberto no Task 5.
- Cancelamento deve abortar a requisicao Groq e encerrar a arvore de processos do terminal; coberto nos Tasks 4 e 8.
- Reinicio com run ativo ou aprovacao pendente deve recuperar estado seguro, marcando o run como falho e rejeitando a aprovacao; coberto no Task 3.

---

### Task 1: Base Electron tipada e segura

**Files:**
- Create: `.gitignore`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `electron.vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vitest.config.ts`
- Create: `src/shared/contracts.ts`
- Create: `src/shared/contracts.test.ts`
- Create: `src/main/index.ts`
- Create: `src/preload/index.ts`
- Create: `src/renderer/index.html`
- Create: `src/renderer/src/main.tsx`
- Create: `src/renderer/src/App.tsx`
- Create: `src/renderer/src/global.d.ts`
- Create: `src/renderer/src/styles.css`

**Interfaces:**
- Produces: `DesktopAPI`, `AgentEvent`, `PermissionMode`, `RunStatus`, `WorkspaceEntry` and IPC request/response schemas exported by `src/shared/contracts.ts`.
- Produces: `window.desktop: DesktopAPI`, exposed by preload without raw Electron objects.

- [ ] **Step 1: Write contract tests**

Add tests named `rejects_invalid_permission_mode`, `accepts_workspace_entry`, and `agent_event_requires_known_discriminator`, asserting Zod parse success/failure for exact contract examples.

- [ ] **Step 2: Run tests to verify the foundation is absent**

Run: `npm test -- --run src/shared/contracts.test.ts`

Expected: FAIL because the test runner/contracts do not exist.

- [ ] **Step 3: Install and configure the application foundation**

Replace the demonstration package configuration with ESM Electron/Vite scripts: `dev`, `build`, `test`, `typecheck`, and `test:e2e`. Add React/Electron runtime dependencies and TypeScript, Vitest, Testing Library, Playwright and Electron build dependencies. Ignore `.env`, `node_modules`, `dist`, `out`, coverage, app data and the existing ZIP. Create a BrowserWindow with secure web preferences and a typed preload bridge.

- [ ] **Step 4: Run foundation checks**

Run: `npm test -- --run src/shared/contracts.test.ts && npm run typecheck && npm run build`

Expected: contract tests PASS; TypeScript reports no errors; Electron bundles main, preload and renderer.

- [ ] **Step 5: Commit**

Run: `git add .gitignore package.json package-lock.json electron.vite.config.ts tsconfig*.json vitest.config.ts src && git commit -m "feat: scaffold secure Electron IDE"`

### Task 2: Workspace filesystem and search boundary

**Files:**
- Create: `src/main/workspace/workspace-service.ts`
- Create: `src/main/workspace/workspace-service.test.ts`
- Create: `src/main/workspace/ripgrep.ts`
- Create: `src/main/ipc/workspace-ipc.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/shared/contracts.ts`

**Interfaces:**
- Produces: `WorkspaceService.open(root)`, `list(relativePath)`, `readText(relativePath, range?)`, `writeTextAtomic(relativePath, content, expectedHash?)`, `remove(relativePath)`, and `search(query, options)`.
- Produces: typed DesktopAPI methods `workspace.open`, `workspace.createFolder`, `workspace.list`, `workspace.readText`, `workspace.saveText`, and `workspace.search`.

- [ ] **Step 1: Write failing workspace tests**

Test workspace-relative listing/reading, `../` traversal rejection, absolute path rejection, secret-file filtering, byte limits, atomic write, expected-hash conflict, and symlink/junction escape rejection using temporary directories.

- [ ] **Step 2: Verify failure**

Run: `npm test -- --run src/main/workspace/workspace-service.test.ts`

Expected: FAIL because `WorkspaceService` is missing.

- [ ] **Step 3: Implement the workspace service and IPC handlers**

Use canonical real paths, explicit size/result limits and structured error codes. Use `rg --json` when available and a bounded JavaScript fallback when it is not. Register only schema-validated IPC channels.

- [ ] **Step 4: Verify workspace behavior**

Run: `npm test -- --run src/main/workspace/workspace-service.test.ts && npm run typecheck`

Expected: all boundary, secret, conflict and fallback tests PASS.

- [ ] **Step 5: Commit**

Run: `git add src/main/workspace src/main/ipc src/main/index.ts src/preload/index.ts src/shared/contracts.ts && git commit -m "feat: add bounded workspace services"`

### Task 3: Durable sessions, events and safe recovery

**Files:**
- Create: `src/main/state/session-store.ts`
- Create: `src/main/state/session-store.test.ts`
- Create: `src/main/state/run-events.ts`
- Create: `src/main/ipc/session-ipc.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/shared/contracts.ts`

**Interfaces:**
- Produces: `SessionStore.createSession(input)`, `listSessions()`, `appendMessage(sessionId, message)`, `appendEvent(runId, event)`, `setRunStatus(runId, status)`, and `recoverInterruptedRuns()`.
- Produces: `RunEventBus.publish(event)`, `subscribe(listener)` and `history(runId)`.

- [ ] **Step 1: Write failing persistence tests**

Test atomic JSON writes, reload after restart, corrupt-store quarantine, event ordering, and recovery that converts `running`/`waiting_approval` to `failed` while recording rejection of pending approvals.

- [ ] **Step 2: Verify failure**

Run: `npm test -- --run src/main/state/session-store.test.ts`

Expected: FAIL because persistence is missing.

- [ ] **Step 3: Implement storage and event delivery**

Store versioned JSON beneath Electron `userData`, write via temp file plus rename, and stream events to subscribed renderer windows. Keep storage path injectable for tests.

- [ ] **Step 4: Verify persistence**

Run: `npm test -- --run src/main/state/session-store.test.ts && npm run typecheck`

Expected: persistence, corruption and safe-recovery tests PASS.

- [ ] **Step 5: Commit**

Run: `git add src/main/state src/main/ipc/session-ipc.ts src/main/index.ts src/preload/index.ts src/shared/contracts.ts && git commit -m "feat: persist agent sessions and events"`

### Task 4: Groq provider, model routing and streaming

**Files:**
- Create: `src/agent/providers/model-provider.ts`
- Create: `src/agent/providers/groq-provider.ts`
- Create: `src/agent/providers/groq-provider.test.ts`
- Create: `src/agent/router/task-router.ts`
- Create: `src/agent/router/task-router.test.ts`
- Create: `src/agent/context/context-builder.ts`
- Create: `src/agent/context/context-builder.test.ts`
- Create: `src/main/ipc/settings-ipc.ts`
- Modify: `src/shared/contracts.ts`

**Interfaces:**
- Produces: `ModelProvider.stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>`.
- Produces: `TaskRouter.route(input): Promise<{ route: "fast" | "deep"; reason: string; requiredTools: string[] }>`.
- Produces: `ContextBuilder.build(input): ModelMessage[]`, excluding secrets and compacting over-budget history.

- [ ] **Step 1: Write failing provider, router and context tests**

Use a fake Groq client to assert token streaming, tool-call assembly, API error normalization and abort propagation. Assert malformed router JSON falls back to `deep`; assert context ordering, secret exclusion and deterministic compaction.

- [ ] **Step 2: Verify failure**

Run: `npm test -- --run src/agent/providers src/agent/router src/agent/context`

Expected: FAIL because provider modules are missing.

- [ ] **Step 3: Implement provider abstraction and Groq adapter**

Read `GROQ_API_KEY` only in main/agent code. Make both model IDs configurable with spec defaults. Convert Groq streaming chunks into internal text/tool events and preserve structured errors without logging credentials.

- [ ] **Step 4: Verify provider behavior**

Run: `npm test -- --run src/agent/providers src/agent/router src/agent/context && npm run typecheck`

Expected: all fake-provider tests PASS, including request cancellation.

- [ ] **Step 5: Commit**

Run: `git add src/agent src/main/ipc/settings-ipc.ts src/shared/contracts.ts && git commit -m "feat: integrate Groq streaming provider"`

### Task 5: Agent loop, tools, approvals and file proposals

**Files:**
- Create: `src/agent/runtime/agent-runner.ts`
- Create: `src/agent/runtime/agent-runner.test.ts`
- Create: `src/agent/runtime/approval-policy.ts`
- Create: `src/agent/runtime/approval-policy.test.ts`
- Create: `src/agent/tools/tool-registry.ts`
- Create: `src/agent/tools/workspace-tools.ts`
- Create: `src/agent/tools/command-tool.ts`
- Create: `src/agent/changes/change-service.ts`
- Create: `src/agent/changes/change-service.test.ts`
- Create: `src/main/ipc/agent-ipc.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/shared/contracts.ts`

**Interfaces:**
- Produces: `AgentRunner.start(input): { runId: string }`, `resolveApproval(runId, approvalId, decision)`, and `cancel(runId)`.
- Produces: `ToolRegistry.register(definition, handler)`, `definitionsForPhase(phase)`, and `execute(name, args, context)`.
- Produces: `ChangeService.propose(change)`, `apply(proposalId)`, `reject(proposalId)`; `apply` checks `baseHash` before atomic write.
- Consumes: `ModelProvider`, `WorkspaceService`, `SessionStore`, and `RunEventBus` from prior tasks.

- [ ] **Step 1: Write failing runtime tests**

Test final-answer completion, multi-step tool loop, 20-iteration stop, cancellation, unknown tool rejection, invalid JSON arguments, approval pause/resume, rejection feedback, default `ask`, `auto-workspace` restrictions, deletion approval, and file conflict preservation.

- [ ] **Step 2: Verify failure**

Run: `npm test -- --run src/agent/runtime src/agent/changes`

Expected: FAIL because runtime modules are missing.

- [ ] **Step 3: Implement the bounded agent harness**

Register the eight tools from the spec, feed structured results back to the provider, persist every state transition, pause the same run for approvals, and make cancel abort both model and active tool execution. Do not expose arbitrary functions received from the model.

- [ ] **Step 4: Verify agent behavior**

Run: `npm test -- --run src/agent/runtime src/agent/changes && npm run typecheck`

Expected: all loop, approval, malformed-input, iteration-limit and conflict tests PASS.

- [ ] **Step 5: Commit**

Run: `git add src/agent src/main/ipc/agent-ipc.ts src/main/index.ts src/preload/index.ts src/shared/contracts.ts && git commit -m "feat: add safe agent tool loop"`

### Task 6: IDE shell, navigation and project lifecycle

**Files:**
- Create: `src/renderer/src/store/ide-store.ts`
- Create: `src/renderer/src/store/ide-store.test.ts`
- Create: `src/renderer/src/components/layout/IdeShell.tsx`
- Create: `src/renderer/src/components/layout/ActivityBar.tsx`
- Create: `src/renderer/src/components/layout/ResizablePanel.tsx`
- Create: `src/renderer/src/components/workspace/Welcome.tsx`
- Create: `src/renderer/src/components/workspace/FileTree.tsx`
- Create: `src/renderer/src/components/workspace/FileTree.test.tsx`
- Create: `src/renderer/src/components/workspace/CreateProjectDialog.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Produces: Zustand `useIdeStore` with workspace, selected activity, panel sizes, open tabs and active session.
- Consumes: `window.desktop.workspace` and `window.desktop.sessions`.

- [ ] **Step 1: Write failing UI state and tree tests**

Test persisted panel sizes, activity selection, lazy folder expansion, file selection, loading state and structured workspace error display.

- [ ] **Step 2: Verify failure**

Run: `npm test -- --run src/renderer/src/store src/renderer/src/components/workspace`

Expected: FAIL because UI modules are missing.

- [ ] **Step 3: Implement the IDE shell**

Create dark/light theme tokens, five-region resizable layout, welcome flow, folder picker, create-project dialog and accessible keyboard/focus states. Do not introduce direct filesystem access.

- [ ] **Step 4: Verify UI shell**

Run: `npm test -- --run src/renderer/src/store src/renderer/src/components/workspace && npm run typecheck`

Expected: store and component tests PASS.

- [ ] **Step 5: Commit**

Run: `git add src/renderer && git commit -m "feat: build IDE workspace shell"`

### Task 7: Monaco editor, tabs and save protection

**Files:**
- Create: `src/renderer/src/components/editor/EditorArea.tsx`
- Create: `src/renderer/src/components/editor/EditorTabs.tsx`
- Create: `src/renderer/src/components/editor/EditorArea.test.tsx`
- Create: `src/renderer/src/lib/languages.ts`
- Modify: `src/renderer/src/store/ide-store.ts`
- Modify: `src/renderer/src/components/workspace/FileTree.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Produces: `openFile(path)`, `updateBuffer(path, content)`, `saveFile(path)`, and `closeFile(path, decision)` actions in `useIdeStore`.
- Consumes: `workspace.readText` and `workspace.saveText` with content hash.

- [ ] **Step 1: Write failing editor tests**

Mock Monaco and assert file loading, language selection, dirty marker, save, save conflict, close confirmation and binary-file refusal.

- [ ] **Step 2: Verify failure**

Run: `npm test -- --run src/renderer/src/components/editor`

Expected: FAIL because editor modules are missing.

- [ ] **Step 3: Implement editor tabs and guarded save**

Open files from the tree, preserve unsaved buffers while switching tabs, bind Ctrl+S, pass the original hash on save and display conflict recovery choices without overwriting external changes.

- [ ] **Step 4: Verify editor**

Run: `npm test -- --run src/renderer/src/components/editor && npm run typecheck`

Expected: all editor behavior tests PASS.

- [ ] **Step 5: Commit**

Run: `git add src/renderer && git commit -m "feat: add Monaco editing workflow"`

### Task 8: Integrated PTY terminal and process lifecycle

**Files:**
- Create: `src/main/terminal/terminal-service.ts`
- Create: `src/main/terminal/terminal-service.test.ts`
- Create: `src/main/ipc/terminal-ipc.ts`
- Create: `src/renderer/src/components/terminal/TerminalPanel.tsx`
- Create: `src/renderer/src/components/terminal/TerminalPanel.test.tsx`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/shared/contracts.ts`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Produces: `TerminalService.create({ cwd, cols, rows })`, `write(id, data)`, `resize(id, cols, rows)`, and `dispose(id)`.
- Produces: typed DesktopAPI terminal lifecycle plus streaming `onData`/`onExit` subscriptions.

- [ ] **Step 1: Write failing terminal tests**

Mock the PTY adapter and assert workspace cwd enforcement, data streaming, resize, timeout, normal exit, explicit disposal and cancellation that kills the process tree.

- [ ] **Step 2: Verify failure**

Run: `npm test -- --run src/main/terminal src/renderer/src/components/terminal`

Expected: FAIL because terminal modules are missing.

- [ ] **Step 3: Implement PTY service and xterm UI**

Use the user's PowerShell on Windows, node-pty in main, xterm.js in renderer and bounded replay for late subscribers. Dispose terminals when their workspace/window closes.

- [ ] **Step 4: Verify terminal behavior**

Run: `npm test -- --run src/main/terminal src/renderer/src/components/terminal && npm run typecheck`

Expected: PTY lifecycle and UI adapter tests PASS.

- [ ] **Step 5: Commit**

Run: `git add src/main/terminal src/main/ipc/terminal-ipc.ts src/main/index.ts src/preload/index.ts src/shared/contracts.ts src/renderer && git commit -m "feat: add integrated workspace terminal"`

### Task 9: Agent chat, approvals, diffs and Mermaid preview

**Files:**
- Create: `src/renderer/src/components/agent/AgentPanel.tsx`
- Create: `src/renderer/src/components/agent/AgentPanel.test.tsx`
- Create: `src/renderer/src/components/agent/ApprovalCard.tsx`
- Create: `src/renderer/src/components/agent/ToolActivity.tsx`
- Create: `src/renderer/src/components/changes/DiffViewer.tsx`
- Create: `src/renderer/src/components/changes/DiffViewer.test.tsx`
- Create: `src/renderer/src/components/preview/MermaidPreview.tsx`
- Create: `src/renderer/src/components/preview/MermaidPreview.test.tsx`
- Modify: `src/renderer/src/store/ide-store.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `window.desktop.agent.start`, `cancel`, `resolveApproval`, `applyProposal`, `rejectProposal`, and `onEvent`.
- Produces: event-reduced UI state keyed by `runId`, including streaming text, tool timeline, approvals and file proposals.

- [ ] **Step 1: Write failing interaction tests**

Test streaming deltas, send/cancel state, tool timeline, approval accept/reject, diff display, apply-conflict message, Mermaid strict security, syntax-error display and listener cleanup.

- [ ] **Step 2: Verify failure**

Run: `npm test -- --run src/renderer/src/components/agent src/renderer/src/components/changes src/renderer/src/components/preview`

Expected: FAIL because agent UI modules are missing.

- [ ] **Step 3: Implement the complete agent experience**

Render conversation and activity separately, keep approvals visually blocking, show unified diffs before apply, allow session-level permission selection, and render Mermaid with `securityLevel: "strict"` and sanitized labels.

- [ ] **Step 4: Verify agent UI**

Run: `npm test -- --run src/renderer/src/components/agent src/renderer/src/components/changes src/renderer/src/components/preview && npm run typecheck`

Expected: all interaction, security and cleanup tests PASS.

- [ ] **Step 5: Commit**

Run: `git add src/renderer && git commit -m "feat: add agent review and architecture UI"`

### Task 10: Templates, integration coverage, documentation and build

**Files:**
- Create: `src/main/projects/project-template-service.ts`
- Create: `src/main/projects/project-template-service.test.ts`
- Create: `src/main/ipc/project-ipc.ts`
- Create: `tests/e2e/ide.spec.ts`
- Create: `tests/integration/agent-workspace-flow.test.ts`
- Create: `.env.example`
- Create: `README.md`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/shared/contracts.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `ProjectTemplateService.preview(input)` and `create(input, confirmationToken)` for `empty`, `node-typescript`, and `react-typescript` templates.
- Consumes: all earlier public interfaces in the end-to-end flow.

- [ ] **Step 1: Write failing template and integration tests**

Assert sanitized project names, no overwrite of non-empty directories, deterministic preview/confirmation, and full fake-provider flow: open workspace, ask agent, read file, propose edit, approve, apply and persist completion. Add Playwright coverage for create project, edit/save, terminal command, approved agent proposal and Mermaid render.

- [ ] **Step 2: Verify failure**

Run: `npm test -- --run src/main/projects tests/integration && npm run test:e2e`

Expected: template/integration tests fail because lifecycle wiring is incomplete.

- [ ] **Step 3: Finish project creation and operator documentation**

Implement preview-confirm-create, add `.env.example` without secrets, and document Node requirements, `GROQ_API_KEY`, `npm install`, `npm run dev`, tests, build, permission modes and known MVP limits. Add an opt-in `npm run smoke:groq` that skips unless `GROQ_API_KEY` and `RUN_GROQ_SMOKE=1` exist.

- [ ] **Step 4: Run the complete verification suite**

Run: `npm test -- --run && npm run typecheck && npm run build && npm run test:e2e`

Expected: unit/integration/E2E tests PASS, TypeScript has no errors, and Electron production bundles are created.

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev`

Expected: the desktop IDE opens; a workspace can be created/opened; editor, terminal, agent approval, diff and Mermaid preview work. If a real Groq key is configured, run `npm run smoke:groq` and expect one streamed completion without tool side effects.

- [ ] **Step 6: Commit**

Run: `git add src tests .env.example README.md package.json package-lock.json && git commit -m "feat: complete Groq desktop IDE MVP"`
