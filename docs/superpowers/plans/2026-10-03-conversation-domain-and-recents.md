# Conversation Domain and Recent Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce cloud-ready workspace/chat/message domain records, migrate existing sessions without data loss, and let users reopen recent or searched workspaces from the welcome screen.

**Architecture:** Add shared versioned domain contracts and a repository interface, then implement them with the existing atomic JSON persistence. Preserve the current `SessionStore` behavior through an adapter-compatible API while renderer IPC migrates to workspace/chat terminology.

**Tech Stack:** TypeScript, Zod, Electron IPC, React 19, Zustand, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-03-cloud-ready-workspaces-multichat-design.md`

## Global Constraints

- Local-first behavior must continue without a network connection.
- Domain contracts must not import Electron, Node, React, or Zustand.
- Persist UUIDs, ISO timestamps, `revision`, and nullable `deletedAt` for syncable entities.
- `localRootPath` remains device-local and must be distinct from future `remoteProjectId`.
- Existing sessions, messages, runs, events, checkpoints, and proposals must survive migration.
- Tests stay focused on migration, ordering, deduplication, and reopening behavior.

## Review Focus

- Two Windows paths differing only by slash style/case migrate to one workspace without losing chats.
- A missing recent directory remains listed and opening it surfaces the existing workspace error.
- Opening a workspace before using the agent still records it in recents.
- Five-item preview order changes when an older workspace is reopened.
- A partially migrated or unsupported JSON file is backed up rather than silently discarded.

---

### Task 1: Shared domain contracts

**Files:**
- Modify: `src/shared/contracts.ts`
- Modify: `src/shared/contracts.test.ts`

**Interfaces:**
- Produces: `WorkspaceRecord`, `ChatRecord`, `ConversationMessage`, `DomainChange`, `PersistedConversationState` schemas and types.

- [ ] **Step 1: Write failing contract tests** for UUID/date/revision fields, local-only workspace path, chat title source/status, message references, and soft deletion.
- [ ] **Step 2: Run** `npm test -- --run src/shared/contracts.test.ts`; expect the new imports/assertions to fail.
- [ ] **Step 3: Implement the Zod schemas and exported types** in `src/shared/contracts.ts`, keeping current IPC types temporarily compatible.
- [ ] **Step 4: Run the focused test** and `npm run typecheck`; expect both to pass.
- [ ] **Step 5: Commit** with `feat: add cloud-ready conversation contracts`.

### Task 2: Repository boundary and v1-to-v2 migration

**Files:**
- Create: `src/main/state/conversation-repository.ts`
- Create: `src/main/state/local-conversation-repository.ts`
- Create: `src/main/state/local-conversation-repository.test.ts`
- Modify: `src/main/state/session-store.ts`
- Modify: `src/main/state/session-store.test.ts`

**Interfaces:**
- Consumes: shared domain records from Task 1.
- Produces: `ConversationRepository` with `listWorkspaces`, `openWorkspaceRecord`, `listChats`, `createChat`, `updateChat`, `appendMessage`, run/event/checkpoint/proposal methods, and `listPendingChanges`.
- Produces: `LocalConversationRepository.open(directory): Promise<LocalConversationRepository>`.

- [ ] **Step 1: Write failing migration tests** using a literal v1 `sessions.json`; assert preserved messages/runs/events/proposals/checkpoints and normalized workspace deduplication.
- [ ] **Step 2: Run** `npm test -- --run src/main/state/local-conversation-repository.test.ts`; expect failure because the repository does not exist.
- [ ] **Step 3: Define `ConversationRepository`** as an Electron-independent persistence boundary.
- [ ] **Step 4: Implement atomic v2 loading/migration** in `LocalConversationRepository`; retain corrupt-file backup behavior and enqueue domain changes without network transmission.
- [ ] **Step 5: Adapt `SessionStore` callers** or turn it into a compatibility facade over the repository so current runner tests remain valid during migration.
- [ ] **Step 6: Run repository and session tests**; expect pass.
- [ ] **Step 7: Commit** with `feat: migrate sessions to conversation repository`.

### Task 3: Workspace/chat IPC surface

**Files:**
- Modify: `src/main/ipc/session-ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/shared/contracts.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `ConversationRepository` from Task 2.
- Produces: `desktop.conversations.listWorkspaces()`, `openWorkspaceRecord(root)`, `listChats(workspaceId)`, and chat CRUD methods used by later plans.

- [ ] **Step 1: Add failing IPC/preload contract tests** for listing workspaces and touching `lastOpenedAt`.
- [ ] **Step 2: Run the focused tests** and confirm missing handlers/API methods cause failure.
- [ ] **Step 3: Register validated IPC handlers** and expose the typed preload API without exposing filesystem or Node primitives.
- [ ] **Step 4: Update main composition** to construct one repository instance and pass it to current services.
- [ ] **Step 5: Run focused tests and typecheck**; expect pass.
- [ ] **Step 6: Commit** with `feat: expose workspace conversation repository over ipc`.

### Task 4: Recent workspace state and welcome UI

**Files:**
- Modify: `src/renderer/src/store/ide-store.ts`
- Modify: `src/renderer/src/store/ide-store.test.ts`
- Modify: `src/renderer/src/components/workspace/Welcome.tsx`
- Create: `src/renderer/src/components/workspace/Welcome.test.tsx`
- Create: `src/renderer/src/components/workspace/AllWorkspacesDialog.tsx`
- Modify: `src/renderer/src/components/layout/IdeShell.tsx`
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: workspace APIs from Task 3.
- Produces: `recentWorkspaces`, `allWorkspaces`, `loadKnownWorkspaces()`, and a searchable all-workspaces dialog.

- [ ] **Step 1: Write failing store tests** asserting five-item ordering, reopen promotion, and recording a workspace before agent use.
- [ ] **Step 2: Write failing component tests** asserting recent cards open on click and **Mostrar todos** searches beyond five records.
- [ ] **Step 3: Run the focused tests**; expect missing state/components.
- [ ] **Step 4: Implement store loading/touch behavior** and preserve existing workspace error handling for missing folders.
- [ ] **Step 5: Implement recent cards and all-workspaces dialog** with keyboard-accessible buttons, search, empty state, and full paths.
- [ ] **Step 6: Add responsive styles** that preserve the existing welcome actions.
- [ ] **Step 7: Run focused tests, typecheck, and existing E2E**; expect pass.
- [ ] **Step 8: Commit** with `feat: add recent workspace launcher`.

### Task 5: Phase verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document recent workspace behavior and v2 migration** without describing future cloud sync as already available.
- [ ] **Step 2: Run** `npm run typecheck`, `npm test -- --run`, `npm run build`, and `$env:RUN_E2E='1'; npm run test:e2e`.
- [ ] **Step 3: Inspect `git diff --check` and migration fixtures**; expect no whitespace errors or accidental secrets.
- [ ] **Step 4: Commit** with `docs: document recent workspace workflow`.
