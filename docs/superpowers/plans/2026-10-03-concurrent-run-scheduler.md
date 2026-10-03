# Concurrent Run Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute at most two agent runs concurrently, persist additional runs in FIFO order, and automatically promote queued work across chats and restarts.

**Architecture:** Place a `RunScheduler` in front of `AgentRunner`; the runner remains responsible for one run's lifecycle while the scheduler owns admission, queue ordering, promotion, and queued cancellation. Persist queue metadata through the conversation repository and expose scheduling state through existing run events/contracts.

**Tech Stack:** TypeScript, Electron IPC, existing AgentRunner/EventBus, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-03-cloud-ready-workspaces-multichat-design.md`

## Global Constraints

- Maximum active executions is exactly `2` across the desktop application.
- Queue order is persistent FIFO using a monotonic `queueSequence`.
- A queued run must not call the model, tools, approvals, or append duplicate user messages.
- Completion, failure, cancellation, or safe recovery frees a slot and promotes one queued run.
- Each run remains isolated by `chatId` and `runId`.
- File proposal hash conflicts remain the final protection against concurrent edits.

## Review Focus

- Two runs finishing nearly simultaneously cannot start more than two queued runs or exceed the active limit.
- Cancelling a queued run never instantiates an `AbortController` or provider stream.
- Restarting with two recoverable active runs and queued work does not reorder or over-admit the queue.
- A queued run whose chat/workspace was deleted is cancelled and does not block following work.
- An approval-waiting run counts as active and does not free a slot.

---

### Task 1: Scheduler state contracts and persistence

**Files:**
- Modify: `src/shared/contracts.ts`
- Modify: `src/shared/contracts.test.ts`
- Modify: `src/main/state/conversation-repository.ts`
- Modify: `src/main/state/local-conversation-repository.ts`
- Modify: `src/main/state/local-conversation-repository.test.ts`

**Interfaces:**
- Produces: queued run records with `chatId`, optional `queueSequence`, and terminal cancellation reason.
- Produces: repository methods `listSchedulableRuns()`, `enqueueRun`, `markRunStarted`, and `cancelQueuedRun`.

- [ ] **Step 1: Write failing persistence tests** for monotonic queue order, restart recovery, invalid queued chat cancellation, and approval-waiting active count.
- [ ] **Step 2: Run focused tests**; expect missing fields/methods.
- [ ] **Step 3: Implement contracts and atomic repository transitions** with revision increments.
- [ ] **Step 4: Run focused tests and typecheck**; expect pass.
- [ ] **Step 5: Commit** with `feat: persist scheduled agent runs`.

### Task 2: Two-slot FIFO scheduler

**Files:**
- Create: `src/agent/runtime/run-scheduler.ts`
- Create: `src/agent/runtime/run-scheduler.test.ts`
- Modify: `src/agent/runtime/agent-runner.ts`

**Interfaces:**
- Produces: `RunScheduler.start(input): Promise<{ runId: string; status: RunStatus; queuePosition?: number }>`.
- Produces: `RunScheduler.cancel(runId)`, `resume(runId)`, `recover()`, and `queueSnapshot()`.
- Consumes: an `AgentRunner` lifecycle callback or terminal event subscription and repository transitions from Task 1.

- [ ] **Step 1: Write failing scheduler tests** for two immediate starts, third queued, FIFO promotion, queued cancellation, simultaneous terminal events, and approval counting as active.
- [ ] **Step 2: Run scheduler tests**; expect missing scheduler.
- [ ] **Step 3: Add a completion notification boundary to `AgentRunner`** without moving single-run logic into the scheduler.
- [ ] **Step 4: Implement admission and serialized promotion** so concurrent terminal events cannot exceed two slots.
- [ ] **Step 5: Implement queued cancel/resume/recovery behavior** without invoking the provider prematurely.
- [ ] **Step 6: Run scheduler and existing runner tests**; expect pass.
- [ ] **Step 7: Commit** with `feat: schedule two concurrent agent runs`.

### Task 3: IPC and renderer queue state

**Files:**
- Modify: `src/main/ipc/agent-ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/shared/contracts.ts`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/src/store/ide-store.ts`
- Modify: `src/renderer/src/store/ide-store.test.ts`

**Interfaces:**
- Consumes: `RunScheduler` from Task 2.
- Produces: agent start/cancel/resume through scheduler and queue-position events rendered in the correct chat.

- [ ] **Step 1: Write failing store/IPC tests** for queued status, queue position changes, promotion, and cancellation from a non-selected chat.
- [ ] **Step 2: Run focused tests**; expect old direct-runner behavior to fail assertions.
- [ ] **Step 3: Route IPC through the scheduler** and publish validated queue events.
- [ ] **Step 4: Update chat-keyed renderer state** to display queue positions and promoted status.
- [ ] **Step 5: Run focused tests and typecheck**; expect pass.
- [ ] **Step 6: Commit** with `feat: expose persistent agent queue`.

### Task 4: Queue controls and status UX

**Files:**
- Modify: `src/renderer/src/components/agent/ChatSidebar.tsx`
- Modify: `src/renderer/src/components/agent/ChatSidebar.test.tsx`
- Modify: `src/renderer/src/components/agent/AgentPanel.tsx`
- Modify: `src/renderer/src/components/agent/AgentPanel.test.tsx`
- Modify: `src/renderer/src/components/agent/ToolActivity.tsx`
- Modify: `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: queue-aware renderer state from Task 3.
- Produces: `Na fila · posição N`, queued cancellation, automatic promotion feedback, and non-selected chat status badges.

- [ ] **Step 1: Write failing component tests** for third-run queue label, position update, queued cancellation, promotion, and two simultaneous running badges.
- [ ] **Step 2: Run focused tests**; expect missing queue UI.
- [ ] **Step 3: Implement queue labels/actions** while preserving approvals, resumable errors, auto-scroll, and grouped execution details.
- [ ] **Step 4: Add accessible live announcements** for promotion and completion in non-selected chats.
- [ ] **Step 5: Run focused tests and typecheck**; expect pass.
- [ ] **Step 6: Commit** with `feat: show concurrent run queue`.

### Task 5: Recovery, integration, and final verification

**Files:**
- Modify: `tests/integration/agent-workspace-flow.test.ts`
- Create: `tests/integration/multichat-scheduler-flow.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write one integration test** with three chats proving two providers start, the third waits, completion promotes it, and all events remain isolated.
- [ ] **Step 2: Write one restart test** proving queue order survives repository reopen.
- [ ] **Step 3: Run integration tests**; expect pass after Tasks 1-4.
- [ ] **Step 4: Document the two-run limit, queue, cancellation, and restart behavior**.
- [ ] **Step 5: Run** `npm run typecheck`, `npm test -- --run`, `npm run build`, and `$env:RUN_E2E='1'; npm run test:e2e`.
- [ ] **Step 6: Run `git diff --check` and inspect untracked files**; do not include local prototypes or secrets.
- [ ] **Step 7: Commit** with `feat: complete concurrent multi-chat execution`.
