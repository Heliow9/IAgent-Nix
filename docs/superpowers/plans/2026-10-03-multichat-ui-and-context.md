# Multi-Chat UI and Context References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent independent chats per workspace, contextual Groq-generated titles, a collapsible chat list, and explicit cross-chat references.

**Architecture:** Extend the repository/IPC delivered by the domain plan, keep selected-chat state in Zustand, and split chat navigation from conversation content. Resolve `@Chat` selections to stable IDs before runtime context construction.

**Tech Stack:** TypeScript, Electron IPC, React 19, Zustand, Groq provider, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-03-cloud-ready-workspaces-multichat-design.md`

## Global Constraints

- Chats are isolated unless explicitly referenced.
- Archived chats remain referenceable but stay outside the default active list.
- Manual titles must never be overwritten by generated titles.
- Generated titles are concise, contextual, and in Brazilian Portuguese.
- Switching chats must not cancel another chat's run.
- UI data access uses repository IPC contracts, never direct filesystem access.

## Review Focus

- Duplicate chat titles resolve by stable ID, not visible text.
- A deleted referenced chat remains represented as unavailable instead of silently binding to another title.
- Rapid chat switching cannot append live events to the wrong visible conversation.
- Title generation failure preserves a usable provisional title and retries at most once.
- Archiving the selected chat selects a deterministic remaining active chat or creates a new one.

---

### Task 1: Chat CRUD and title state

**Files:**
- Modify: `src/main/state/conversation-repository.ts`
- Modify: `src/main/state/local-conversation-repository.ts`
- Modify: `src/main/state/local-conversation-repository.test.ts`
- Modify: `src/main/ipc/session-ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/shared/contracts.ts`

**Interfaces:**
- Produces: `createChat(workspaceId, provisionalTitle)`, `renameChat(chatId, title, source)`, `archiveChat(chatId)`, and `getChatContext(chatId)`.

- [ ] **Step 1: Write failing repository tests** for create/list ordering, manual rename protection, archive filtering, and deterministic fallback selection.
- [ ] **Step 2: Run the focused tests**; expect missing methods.
- [ ] **Step 3: Implement repository operations and validated IPC/preload methods** with revision increments and pending domain changes.
- [ ] **Step 4: Run focused tests and typecheck**; expect pass.
- [ ] **Step 5: Commit** with `feat: add persistent chat management`.

### Task 2: Contextual title generator

**Files:**
- Create: `src/agent/titles/chat-title-service.ts`
- Create: `src/agent/titles/chat-title-service.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/agent/runtime/agent-runner.ts`

**Interfaces:**
- Produces: `ChatTitleService.generate(input: { firstMessage: string; firstAnswer?: string; signal?: AbortSignal }): Promise<string>`.
- Consumes: repository rename method from Task 1 and the configured fast Groq model.

- [ ] **Step 1: Write failing tests** for Portuguese contextual output normalization, maximum title length, fallback, one retry, and manual-title protection.
- [ ] **Step 2: Run the title tests**; expect missing service.
- [ ] **Step 3: Implement provisional title derivation** synchronously and model title generation after the first response.
- [ ] **Step 4: Wire generation to completed first runs** without blocking the user-visible answer.
- [ ] **Step 5: Run focused runtime/title tests**; expect pass.
- [ ] **Step 6: Commit** with `feat: generate contextual chat titles`.

### Task 3: Multi-chat renderer state

**Files:**
- Modify: `src/renderer/src/store/ide-store.ts`
- Modify: `src/renderer/src/store/ide-store.test.ts`

**Interfaces:**
- Produces: `chats`, `selectedChatId`, `chatViews`, `createChat`, `selectChat`, `renameChat`, and `archiveChat` state/actions.

- [ ] **Step 1: Write failing store tests** for isolated message/run/proposal state, switching during a live run, archive fallback, and persisted hydration.
- [ ] **Step 2: Run the store test**; expect missing multi-chat state.
- [ ] **Step 3: Replace global conversation/active-run selection with chat-keyed views** while retaining existing file/editor state.
- [ ] **Step 4: Route incoming events by `runId -> chatId`** and keep unread completion indicators for non-selected chats.
- [ ] **Step 5: Run focused tests and typecheck**; expect pass.
- [ ] **Step 6: Commit** with `refactor: isolate renderer state by chat`.

### Task 4: Collapsible chat navigation

**Files:**
- Create: `src/renderer/src/components/agent/ChatSidebar.tsx`
- Create: `src/renderer/src/components/agent/ChatSidebar.test.tsx`
- Modify: `src/renderer/src/components/agent/AgentPanel.tsx`
- Modify: `src/renderer/src/components/agent/AgentPanel.test.tsx`
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: chat-keyed store API from Task 3.
- Produces: collapsible/searchable active and archived chat navigation with create/rename/archive actions and status indicators.

- [ ] **Step 1: Write failing component tests** for collapse/expand, search, create, rename, archive, queued/running/approval badges, and switching without cancellation.
- [ ] **Step 2: Run focused component tests**; expect missing component.
- [ ] **Step 3: Implement `ChatSidebar`** with accessible controls and compact collapsed state.
- [ ] **Step 4: Refactor `AgentPanel`** so only the selected chat's conversation/actions render.
- [ ] **Step 5: Add responsive styles** for the existing narrow agent panel.
- [ ] **Step 6: Run focused tests and typecheck**; expect pass.
- [ ] **Step 7: Commit** with `feat: add collapsible multi-chat navigation`.

### Task 5: Explicit chat references

**Files:**
- Create: `src/renderer/src/components/agent/ChatReferencePicker.tsx`
- Create: `src/renderer/src/components/agent/ChatReferencePicker.test.tsx`
- Modify: `src/renderer/src/components/agent/AgentPanel.tsx`
- Modify: `src/renderer/src/store/ide-store.ts`
- Modify: `src/agent/context/context-builder.ts`
- Modify: `src/agent/context/context-builder.test.ts`
- Modify: `src/agent/runtime/agent-runner.ts`

**Interfaces:**
- Produces: persisted `referencedChatIds`, visible reference chips, and context sections containing cited chat summaries/relevant paths.

- [ ] **Step 1: Write failing picker tests** for `@` activation, search, duplicate titles, chip removal, archived chats, and missing references.
- [ ] **Step 2: Write failing context tests** asserting only explicitly cited chat summaries are included.
- [ ] **Step 3: Run focused tests**; expect missing reference behavior.
- [ ] **Step 4: Implement picker/chips and persist stable IDs with the outgoing message**.
- [ ] **Step 5: Resolve referenced contexts in the runtime** and add them within the existing character budget.
- [ ] **Step 6: Run focused tests, typecheck, and agent integration tests**; expect pass.
- [ ] **Step 7: Commit** with `feat: reference context from other chats`.

### Task 6: Phase verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document chat creation, navigation, archive, contextual titles, and `@Chat` references**.
- [ ] **Step 2: Run** `npm run typecheck`, `npm test -- --run`, `npm run build`, and current E2E.
- [ ] **Step 3: Manually smoke two chats** using a fake/local provider fixture if no Groq key is available.
- [ ] **Step 4: Commit** with `docs: document multi-chat workflow`.
