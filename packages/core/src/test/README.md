# FlowMonkey Core Tests

This directory contains the comprehensive test suite for the `@flowmonkey/core` package.

## Test Organization

Tests are organized by the component/feature they cover:

| File | Coverage | Tests |
|------|----------|-------|
| [engine.test.ts](./engine.test.ts) | Core execution engine | 45 |
| [memory-store.test.ts](./memory-store.test.ts) | In-memory state store | 25 |
| [context-limits.test.ts](./context-limits.test.ts) | Context validation | 16 |
| [input-resolver.test.ts](./input-resolver.test.ts) | Input selectors | 20 |
| [handler-registry.test.ts](./handler-registry.test.ts) | Handler registry | 15 |
| [flow-registry.test.ts](./flow-registry.test.ts) | Flow registry | 13 |

**Total: 134 tests**

## Running Tests

```bash
# Run all tests
pnpm test

# Run with verbose output
pnpm test -- --reporter=verbose

# Run specific test file
pnpm test -- src/test/engine.test.ts

# Watch mode
pnpm test:watch
```

## Test Categories

### Engine Tests (`engine.test.ts`)

The main execution engine tests covering:

- **Simple Flow Execution** — Basic flow completion and history recording
- **Branching** — Conditional step routing
- **Wait/Resume** — Handler waiting and resumption
- **Error Handling** — `onFailure` transitions and recovery
- **Cancellation** — Full cancellation system with children and tokens
- **Idempotency** — Deduplication via idempotency keys
- **Max Steps** — Infinite loop protection
- **Create Options** — Custom IDs, tenant IDs, metadata, timeouts
- **Status Transitions** — State machine correctness
- **Events** — EventBus lifecycle emissions

### Memory Store Tests (`memory-store.test.ts`)

In-memory `StateStore` implementation:

- **Basic CRUD** — Save, load, delete, mutation protection
- **Wake Queries** — `listWakeReady()` for scheduler
- **Status Queries** — `listByStatus()` filtering
- **Idempotency** — `findByIdempotencyKey()` lookups
- **Hierarchy** — `findChildren()` for sub-flows
- **Timeout Detection** — `findTimedOutExecutions()`, `findTimedOutWaits()`

### Context Limits Tests (`context-limits.test.ts`)

Context validation for resource protection:

- **Size Calculation** — `calculateValueSize()` for primitives/objects
- **Nesting Depth** — `calculateNestingDepth()` for complex structures
- **Limit Enforcement** — Max value size, total size, key count, depth

### Input Resolver Tests (`input-resolver.test.ts`)

All six input selector types:

| Selector | Purpose |
|----------|---------|
| `key` | Single context key |
| `keys` | Multiple keys as object |
| `path` | Dot-notation path access |
| `template` | String interpolation |
| `full` | Entire context |
| `static` | Literal value |

### Handler Registry Tests (`handler-registry.test.ts`)

Handler management for the engine:

- **Registration** — Add, duplicate detection
- **Retrieval** — Get by type, existence check
- **Metadata** — Schema and description access
- **Filtering** — By category, stateful/stateless
- **Manifest Export** — For GUI tooling

### Flow Registry Tests (`flow-registry.test.ts`)

Flow definition storage:

- **Registration** — Valid flow acceptance
- **Validation** — Invalid flow rejection
- **Versioning** — Multiple versions per flow ID
- **Retrieval** — Latest vs specific version

## Test Fixtures

### Handlers (`handlers.ts`)

Test handlers for various scenarios:

- `echoHandler` — Returns input unchanged
- `transformHandler` — String transforms (upper/lower/reverse)
- `delayHandler` — Simulates waiting
- `failHandler` — Intentional failures
- `branchHandler` — Conditional routing
- `setHandler` — Static value output
- `slowHandler` — Timeout testing (respects abort signal)
- `contextSetHandler` — Context manipulation

### Flows (`flows.ts`)

Predefined test flows:

- `simpleFlow` — Echo → Transform (2 steps)
- `branchFlow` — Conditional branching (4 steps)
- `waitFlow` — Start → Wait → Finish (3 steps)
- `errorFlow` — Fail → Recover (2 steps)
- `infiniteFlow` — Loops forever (for max steps test)
- `longWaitFlow` — Extended wait (for cancellation tests)

### Harness (`harness.ts`)

`TestHarness` class providing:

- Preconfigured `Engine`, `MemoryStore`, registries
- Event capture for assertions
- Helper methods: `run()`, `create()`, `tick()`
- Assertion helpers: `assertCompleted()`, `assertFailed()`, `assertCancelled()`

## Writing New Tests

1. **Use TestHarness** for integration tests:
   ```typescript
   const t = new TestHarness({
     handlers: [myHandler],
     flows: [myFlow],
   });
   
   const { execution } = await t.run('my-flow', { input: 'data' });
   t.assertCompleted(execution);
   ```

2. **Unit test components directly** for isolation:
   ```typescript
   const registry = new DefaultHandlerRegistry();
   registry.register(myHandler);
   expect(registry.has('my-type')).toBe(true);
   ```

3. **Follow naming conventions**:
   - Test files: `{component}.test.ts`
   - Describe blocks: Component name
   - Test names: Behavior being tested

4. **Add new handlers/flows** to fixtures if reusable.

## Coverage Goals

| Area | Target | Current |
|------|--------|---------|
| Engine | 90%+ | Yes |
| Stores | 90%+ | Yes |
| Registries | 85%+ | Yes |
| Utils | 80%+ | Yes |
