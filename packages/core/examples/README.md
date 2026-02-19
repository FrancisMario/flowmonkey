# FlowMonkey Core — Examples

Runnable examples demonstrating the main features of `@flowmonkey/core`.  
Each file is self-contained — copy-paste and run with `npx tsx <file>`.

| # | File | Feature |
|---|------|---------|
| 1 | [01-basic-flow.ts](./01-basic-flow.ts) | Defining flows, handlers, and running to completion |
| 2 | [02-input-selectors.ts](./02-input-selectors.ts) | All 6 input selector types (key, keys, path, template, full, static) |
| 3 | [03-error-handling.ts](./03-error-handling.ts) | onFailure transitions, error propagation, handler failures |
| 4 | [04-retry-backoff.ts](./04-retry-backoff.ts) | Step retry with exponential backoff, retryOn filters |
| 5 | [05-conditional-switch.ts](./05-conditional-switch.ts) | Conditional branching (13 operators) and switch routing |
| 6 | [06-waiting-resume.ts](./06-waiting-resume.ts) | Wait/resume pattern, external signals, timeouts |
| 7 | [07-sub-flows.ts](./07-sub-flows.ts) | Parent/child executions, fire-and-forget, wait-for-completion |
| 8 | [08-events-observability.ts](./08-events-observability.ts) | EventDispatcher, wildcard listeners, metrics collection |
| 9 | [09-pipes-datastore.ts](./09-pipes-datastore.ts) | Tables, pipes, automatic data routing from step outputs |
| 10 | [10-cancellation.ts](./10-cancellation.ts) | Cancellation, cascading to children, token invalidation |
| 11 | [11-idempotency.ts](./11-idempotency.ts) | Deduplication with idempotency keys and TTL windows |
| 12 | [12-testing-harness.ts](./12-testing-harness.ts) | TestHarness patterns for unit and integration testing |

## Running

```bash
# From the repo root
pnpm build
npx tsx packages/core/examples/01-basic-flow.ts

# Or run all examples
for f in packages/core/examples/*.ts; do
  echo "=== $f ==="
  npx tsx "$f"
done
```

## Prerequisites

These examples use `@flowmonkey/core` directly. From a fresh clone:

```bash
pnpm install
pnpm build
```
