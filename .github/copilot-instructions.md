## FlowMonkey — Quick orientation for coding agents

This repo is a small workflow engine split into focused packages. Aim to make minimal, safe changes and follow existing conventions shown in tests and harnesses.

- Workspace: root manages packages with pnpm (pnpm-workspace.yaml).
- Node: requires Node >= 20 (see root `package.json`).

### High-level architecture (read before editing core logic)
- `packages/core` — the engine: types, interfaces, `Engine` (stateless), registries, in-memory store, and a test harness.
  - Key files: `src/engine/execution-engine.ts`, `src/impl/flow-registry.ts`, `src/impl/handler-registry.ts`, `src/impl/memory-store.ts`, `src/test/harness.ts`.
  - Important concept: Engine is stateless — all mutable state lives in `Execution` objects persisted via a `StateStore` implementation.
- `packages/handlers` — example handlers (http, delay, llm, webhook). Handlers implement `StepHandler` (`src/handlers.ts`).
- `packages/jobs` — job runner for stateful handlers (polling runner example). See `src/runner.ts`.
- `packages/postgres` / `packages/redis` — production stores and coordination. DB schema: `packages/postgres/src/schema.ts`.
- `packages/triggers` — start flows from external events (HTTP, cron, event). See `src/triggers.ts`.

### Patterns and conventions to follow
- Flows and steps: see `packages/core/src/types/flow.ts`. Use `input` selectors (`key`, `keys`, `path`, `template`, `full`, `static`) and `transitions` (`onSuccess`, `onFailure`, `onResume`).
- Handlers: register by `DefaultHandlerRegistry.register(handler)`. Handler must export `type` string and implement `execute(params)`. For stateful handlers, set `stateful = true` and use job store pattern.
- Persistence: Execution lifecycle is persisted via `StateStore` interface. Use `MemoryStore` only for tests. For production, prefer `PgExecutionStore` (see `packages/postgres`).
- Tests/harness: prefer `TestHarness` (`packages/core/src/test/harness.ts`) for unit tests—it shows how tests register handlers/flows and run flows synchronously with `simulateTime`.
- Error/transition handling: Engine handles handler errors, input resolution errors, invalid transitions. Follow existing error codes and `ExecutionError` types in `packages/core/src/types/errors.ts`.

### Common developer workflows / commands
- Install: `pnpm install` (run in WSL as workspace root).
- Build all packages: `pnpm build` (root runs `pnpm -r build`).
- Dev (watch): `pnpm dev` (root uses `pnpm -r --parallel dev`).
- Run all tests (workspace vitest config): `pnpm test` from repo root. For watch: `pnpm test:watch`.
- Run tests for a single package (explicit filter): `pnpm -w --filter @flowmonkey/core test` (or `pnpm --filter @flowmonkey/core test` depending on pnpm version).
- Typecheck / lint: `pnpm typecheck` (`tsc --noEmit` per package). Root script runs recursive scripts.

### Integration touchpoints
- Database: `packages/postgres/src/schema.ts` contains SQL and `applySchema(pool)` helper — use this to initialize DB in integration tests.
- Jobs: job lifecycle (create/claim/complete/fail) is modeled in `packages/postgres/src/job-store.ts` and exercised by `packages/jobs/src/runner.ts`.
- EventBus: lightweight event callbacks are used by the engine for observability (see `packages/core/src/test/harness.ts` event examples). Look for `EventBus` interface in `packages/core/src/interfaces/event-bus.ts`.

### Small guidance for PRs
- Keep changes small and covered by unit tests. Use `TestHarness` to exercise flows end-to-end without external infra.
- Prefer adding examples in `packages/*/src/test` or the core `test` files rather than changing harness behavior.
- When adding a handler, add it to `packages/handlers/src/handlers.ts` and register it in tests via `TestHarness` handlers option.
- When adding or changing persistence behavior, update `packages/postgres` schema and provide migration notes; include `applySchema` usage in integration tests.

### Files to inspect for context (start here)
- `packages/core/src/engine/execution-engine.ts` (core logic)
- `packages/core/src/types/flow.ts` (flow/step shape)
- `packages/core/src/impl/*` (stores & registries)
- `packages/core/src/test/harness.ts` and `packages/core/src/test/engine.test.ts` (usage examples)
- `packages/handlers/src/handlers.ts` (concrete handler patterns)
- `packages/postgres/src/schema.ts` (DB expectations)

If anything here is unclear or you want me to expand an area (examples for adding a new handler, wiring the Postgres stores into a local dev run, or a checklist for PRs), tell me which part and I'll update this file.
