# FlowMonkey — Monorepo Specification

**Version:** 0.0.1  
**Status:** Draft  
**Last Updated:** January 2026

---

## Table of Contents

1. [Overview](#1-overview)
2. [Monorepo Structure](#2-monorepo-structure)
3. [Root Configuration](#3-root-configuration)
4. [Package: @flowmonkey/core](#4-package-flowmonkeycore)
5. [Testing Strategy](#5-testing-strategy)
6. [Developer Workflow](#6-developer-workflow)
7. [Future Packages](#7-future-packages)

---

## 1. Overview

### 1.1 What is FlowMonkey?

FlowMonkey is a minimal, deterministic workflow execution engine. It's the core infrastructure that powers Agentic Flow, but packaged as a standalone, reusable library.

### 1.2 Design Goals

1. **Simple** — Engineers can understand the entire core in an afternoon
2. **Testable** — Every component is easily unit testable
3. **Extensible** — Add new capabilities without touching core
4. **Zero opinions** — No forced dependencies on databases, transports, or frameworks

### 1.3 Package Overview

| Package | Purpose | Status |
|---------|---------|--------|
| `@flowmonkey/core` | Execution engine, types, interfaces | v0.0.1 |
| `@flowmonkey/redis` | Redis StateStore + EventBus | Planned |
| `@flowmonkey/postgres` | Postgres StateStore | Planned |
| `@flowmonkey/handlers` | Common handlers (http, delay, branch) | Planned |

---

## 2. Monorepo Structure

```
flowmonkey/
├── packages/
│   └── core/                        # @flowmonkey/core
│       ├── src/
│       │   ├── index.ts             # Public exports
│       │   ├── types/
│       │   │   ├── flow.ts
│       │   │   ├── execution.ts
│       │   │   ├── result.ts
│       │   │   └── errors.ts
│       │   ├── interfaces/
│       │   │   ├── state-store.ts
│       │   │   ├── step-handler.ts
│       │   │   ├── handler-registry.ts
│       │   │   ├── flow-registry.ts
│       │   │   └── event-bus.ts
│       │   ├── engine/
│       │   │   ├── execution-engine.ts
│       │   │   └── input-resolver.ts
│       │   ├── impl/
│       │   │   ├── memory-store.ts
│       │   │   ├── handler-registry.ts
│       │   │   └── flow-registry.ts
│       │   └── utils/
│       │       ├── id.ts
│       │       ├── time.ts
│       │       └── validation.ts
│       ├── test/
│       │   ├── harness.ts           # TestHarness class
│       │   ├── handlers.ts          # Mock handlers
│       │   ├── flows.ts             # Test fixtures
│       │   ├── engine.test.ts
│       │   ├── input-resolver.test.ts
│       │   └── validation.test.ts
│       ├── package.json
│       ├── tsconfig.json
│       └── README.md
├── package.json                     # Root workspace config
├── pnpm-workspace.yaml
├── tsconfig.base.json               # Shared TS config
├── vitest.workspace.ts              # Shared test config
├── .gitignore
├── .npmrc
└── README.md
```

---

## 3. Root Configuration

### 3.1 package.json (root)

```json
{
  "name": "flowmonkey",
  "private": true,
  "version": "0.0.1",
  "description": "Minimal workflow execution engine",
  "scripts": {
    "build": "pnpm -r build",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "clean": "pnpm -r clean",
    "dev": "pnpm -r --parallel dev"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "^2.0.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  },
  "packageManager": "pnpm@9.0.0",
  "engines": {
    "node": ">=20.0.0"
  }
}
```

### 3.2 pnpm-workspace.yaml

```yaml
packages:
  - 'packages/*'
```

### 3.3 tsconfig.base.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  }
}
```

### 3.4 vitest.workspace.ts

```typescript
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/*/vitest.config.ts',
]);
```

### 3.5 .gitignore

```
node_modules/
dist/
coverage/
.turbo/
*.log
.DS_Store
```

### 3.6 .npmrc

```
auto-install-peers=true
strict-peer-dependencies=false
```

### 3.7 README.md (root)

```markdown
# FlowMonkey

Minimal workflow execution engine.

## Quick Start

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Build all packages
pnpm build
```

## Packages

| Package | Description |
|---------|-------------|
| [@flowmonkey/core](./packages/core) | Core execution engine |

## Development

```bash
# Watch mode for development
pnpm dev

# Run tests in watch mode
pnpm test:watch

# Type check
pnpm typecheck
```
```

---

## 4. Package: @flowmonkey/core

### 4.1 packages/core/package.json

```json
{
  "name": "@flowmonkey/core",
  "version": "0.0.1",
  "description": "FlowMonkey core execution engine",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      },
      "require": {
        "types": "./dist/index.d.cts",
        "default": "./dist/index.cjs"
      }
    },
    "./test": {
      "import": {
        "types": "./dist/test.d.ts",
        "default": "./dist/test.js"
      },
      "require": {
        "types": "./dist/test.d.cts",
        "default": "./dist/test.cjs"
      }
    }
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  },
  "peerDependencies": {},
  "dependencies": {},
  "repository": {
    "type": "git",
    "url": "https://github.com/your-org/flowmonkey.git",
    "directory": "packages/core"
  },
  "license": "MIT"
}
```

### 4.2 packages/core/tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

### 4.3 packages/core/tsup.config.ts

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    test: 'src/test.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
});
```

### 4.4 packages/core/vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
  },
});
```

---

## 4.5 Core Types

### src/types/flow.ts

```typescript
/**
 * A Flow is a predefined workflow definition.
 */
export interface Flow {
  /** Unique identifier (kebab-case) */
  readonly id: string;

  /** Semantic version */
  readonly version: string;

  /** Human-readable name */
  readonly name?: string;

  /** Starting step ID */
  readonly initialStepId: string;

  /** Step definitions */
  readonly steps: Record<string, Step>;
}

/**
 * A Step is a single unit of work.
 */
export interface Step {
  /** Must match the key in Flow.steps */
  readonly id: string;

  /** Handler type (e.g., "http", "delay", "branch") */
  readonly type: string;

  /** Handler-specific config (opaque to core) */
  readonly config: Record<string, unknown>;

  /** How to get input from context */
  readonly input: InputSelector;

  /** Where to store output (dot notation ok) */
  readonly outputKey?: string;

  /** What happens after this step */
  readonly transitions: StepTransitions;

  /** Optional display name */
  readonly name?: string;
}

/**
 * How to extract input from execution context.
 */
export type InputSelector =
  | { type: 'key'; key: string }              // context[key]
  | { type: 'keys'; keys: string[] }          // pick multiple keys
  | { type: 'path'; path: string }            // dot notation: "a.b.c"
  | { type: 'template'; template: unknown }   // ${path} interpolation
  | { type: 'full' }                          // entire context
  | { type: 'static'; value: unknown };       // hardcoded value

/**
 * Transition rules after step execution.
 */
export interface StepTransitions {
  /** Next step on success (null = complete) */
  readonly onSuccess?: string | null;

  /** Next step on failure (null = fail execution) */
  readonly onFailure?: string | null;

  /** Next step when resuming from wait */
  readonly onResume?: string;
}
```

### src/types/execution.ts

```typescript
/**
 * An Execution is a running instance of a Flow.
 */
export interface Execution {
  /** Unique ID (UUID) */
  readonly id: string;

  /** Which flow this runs */
  readonly flowId: string;

  /** Flow version at creation time */
  readonly flowVersion: string;

  /** Current step */
  currentStepId: string;

  /** Current status */
  status: ExecutionStatus;

  /** Shared data between steps */
  context: Record<string, unknown>;

  /** When to wake (for waiting status) */
  wakeAt?: number;

  /** Why waiting (human readable) */
  waitReason?: string;

  /** Error info (for failed status) */
  error?: ExecutionError;

  /** Steps executed so far */
  stepCount: number;

  /** Step execution history (optional) */
  history?: StepHistory[];

  /** Creation timestamp (ms) */
  readonly createdAt: number;

  /** Last update timestamp (ms) */
  updatedAt: number;

  /** Optional tenant ID for multi-tenancy */
  readonly tenantId?: string;

  /** Optional custom metadata */
  metadata?: Record<string, unknown>;
}

export type ExecutionStatus =
  | 'pending'    // Created, not started
  | 'running'    // Executing a step
  | 'waiting'    // Paused, waiting for wake
  | 'completed'  // Successfully finished
  | 'failed';    // Terminated with error

export interface ExecutionError {
  readonly code: string;
  readonly message: string;
  readonly stepId: string;
  readonly details?: unknown;
  readonly timestamp: number;
}

export interface StepHistory {
  readonly stepId: string;
  readonly handlerType: string;
  readonly outcome: 'success' | 'failure' | 'wait';
  readonly startedAt: number;
  readonly completedAt: number;
  readonly durationMs: number;
  readonly error?: unknown;
}
```

### src/types/result.ts

```typescript
/**
 * Result returned by a StepHandler.
 * This is the ONLY way handlers communicate with the engine.
 */
export interface StepResult {
  /** What happened */
  readonly outcome: 'success' | 'failure' | 'wait';

  /** Output to store in context */
  readonly output?: unknown;

  /** Error info (for failure) */
  readonly error?: StepError;

  /** When to wake (for wait) */
  readonly wakeAt?: number;

  /** Why waiting (for wait) */
  readonly waitReason?: string;

  /** Override default transition */
  readonly nextStepOverride?: string | null;
}

export interface StepError {
  readonly code: string;
  readonly message: string;
  readonly retryable?: boolean;
  readonly details?: unknown;
}

/**
 * Helper functions for creating results.
 */
export const Result = {
  success(output?: unknown): StepResult {
    return { outcome: 'success', output };
  },

  failure(code: string, message: string, details?: unknown): StepResult {
    return { outcome: 'failure', error: { code, message, details } };
  },

  wait(durationMs: number, reason?: string): StepResult {
    return {
      outcome: 'wait',
      wakeAt: Date.now() + durationMs,
      waitReason: reason,
    };
  },

  waitUntil(timestamp: number, reason?: string): StepResult {
    return { outcome: 'wait', wakeAt: timestamp, waitReason: reason };
  },

  waitForSignal(reason: string): StepResult {
    return { outcome: 'wait', waitReason: reason };
  },
} as const;
```

### src/types/errors.ts

```typescript
/**
 * Base error for all FlowMonkey errors.
 */
export class FlowMonkeyError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'FlowMonkeyError';
  }
}

/**
 * Flow definition is invalid.
 */
export class FlowValidationError extends FlowMonkeyError {
  constructor(
    public readonly flowId: string,
    public readonly issues: ValidationIssue[]
  ) {
    super('FLOW_INVALID', `Flow "${flowId}" is invalid: ${issues[0]?.message}`);
    this.name = 'FlowValidationError';
  }
}

/**
 * Execution is in an unexpected state.
 */
export class ExecutionError extends FlowMonkeyError {
  constructor(
    code: string,
    public readonly executionId: string,
    message: string
  ) {
    super(code, message);
    this.name = 'ExecutionError';
  }
}

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
  readonly severity: 'error' | 'warning';
}
```

---

## 4.6 Interfaces

### src/interfaces/state-store.ts

```typescript
import type { Execution, ExecutionStatus } from '../types/execution';

/**
 * Persistence layer for executions.
 * Implement this for Redis, Postgres, etc.
 */
export interface StateStore {
  /** Load an execution by ID */
  load(id: string): Promise<Execution | null>;

  /** Save an execution (create or update) */
  save(execution: Execution): Promise<void>;

  /** Delete an execution */
  delete(id: string): Promise<boolean>;

  /** Find executions ready to wake */
  listWakeReady(now: number, limit?: number): Promise<string[]>;

  /** Find executions by status */
  listByStatus(status: ExecutionStatus, limit?: number): Promise<Execution[]>;
}
```

### src/interfaces/step-handler.ts

```typescript
import type { Step } from '../types/flow';
import type { StepResult } from '../types/result';

/**
 * Executes a step type.
 * Implement this for http calls, LLM invocations, delays, etc.
 */
export interface StepHandler {
  /** Unique type identifier (e.g., "http", "delay") */
  readonly type: string;

  /** Execute the step */
  execute(params: HandlerParams): Promise<StepResult>;
}

export interface HandlerParams {
  /** Resolved input from context */
  readonly input: unknown;

  /** Step definition */
  readonly step: Step;

  /** Read-only context */
  readonly context: Readonly<Record<string, unknown>>;

  /** Execution info for logging */
  readonly execution: {
    readonly id: string;
    readonly flowId: string;
    readonly stepCount: number;
  };

  /** Cancellation signal */
  readonly signal?: AbortSignal;
}
```

### src/interfaces/handler-registry.ts

```typescript
import type { StepHandler } from './step-handler';

/**
 * Registry of step handlers.
 */
export interface HandlerRegistry {
  /** Register a handler */
  register(handler: StepHandler): void;

  /** Register multiple handlers */
  registerAll(handlers: StepHandler[]): void;

  /** Get handler by type */
  get(type: string): StepHandler | undefined;

  /** Check if type is registered */
  has(type: string): boolean;

  /** List all registered types */
  types(): string[];
}
```

### src/interfaces/flow-registry.ts

```typescript
import type { Flow } from '../types/flow';
import type { ValidationIssue } from '../types/errors';

/**
 * Registry of flow definitions.
 */
export interface FlowRegistry {
  /** Register a flow (validates first) */
  register(flow: Flow): void;

  /** Get flow by ID (latest version if no version specified) */
  get(id: string, version?: string): Flow | undefined;

  /** Check if flow exists */
  has(id: string): boolean;

  /** List all flow IDs */
  flowIds(): string[];

  /** Validate without registering */
  validate(flow: Flow): ValidationIssue[];
}
```

### src/interfaces/event-bus.ts

```typescript
import type { Execution } from '../types/execution';
import type { StepResult } from '../types/result';

/**
 * Optional event publishing.
 * Implement for logging, metrics, webhooks, etc.
 */
export interface EventBus {
  onExecutionCreated?(e: { executionId: string; flowId: string; context: Record<string, unknown> }): void;
  onExecutionStarted?(e: { executionId: string; flowId: string; stepId: string }): void;
  onStepStarted?(e: { executionId: string; stepId: string; input: unknown }): void;
  onStepCompleted?(e: { executionId: string; stepId: string; result: StepResult; durationMs: number }): void;
  onExecutionCompleted?(e: { executionId: string; context: Record<string, unknown>; totalSteps: number }): void;
  onExecutionFailed?(e: { executionId: string; stepId: string; error: { code: string; message: string } }): void;
  onExecutionWaiting?(e: { executionId: string; stepId: string; wakeAt?: number; reason?: string }): void;
}
```

---

## 4.7 Engine Implementation

### src/engine/execution-engine.ts

```typescript
import type { Flow, Step } from '../types/flow';
import type { Execution, StepHistory } from '../types/execution';
import type { StepResult } from '../types/result';
import type { StateStore } from '../interfaces/state-store';
import type { HandlerRegistry } from '../interfaces/handler-registry';
import type { FlowRegistry } from '../interfaces/flow-registry';
import type { EventBus } from '../interfaces/event-bus';
import { ExecutionError } from '../types/errors';
import { resolveInput } from './input-resolver';
import { generateId, now, setPath } from '../utils';

export interface EngineOptions {
  /** Record step history (default: false) */
  recordHistory?: boolean;
  /** Max steps per execution (default: 1000) */
  maxSteps?: number;
  /** Handler timeout in ms (default: 30000) */
  timeoutMs?: number;
}

export interface TickResult {
  /** No more ticks needed */
  done: boolean;
  /** Current status */
  status: Execution['status'];
  /** Step that was executed */
  stepId?: string;
  /** Step outcome */
  outcome?: StepResult['outcome'];
  /** When to tick again (for waiting) */
  wakeAt?: number;
  /** Error info */
  error?: { code: string; message: string };
}

/**
 * Core execution engine.
 * Stateless — all state lives in Execution objects via StateStore.
 */
export class Engine {
  private readonly store: StateStore;
  private readonly handlers: HandlerRegistry;
  private readonly flows: FlowRegistry;
  private readonly events?: EventBus;
  private readonly opts: Required<EngineOptions>;

  constructor(
    store: StateStore,
    handlers: HandlerRegistry,
    flows: FlowRegistry,
    events?: EventBus,
    options?: EngineOptions
  ) {
    this.store = store;
    this.handlers = handlers;
    this.flows = flows;
    this.events = events;
    this.opts = {
      recordHistory: options?.recordHistory ?? false,
      maxSteps: options?.maxSteps ?? 1000,
      timeoutMs: options?.timeoutMs ?? 30000,
    };
  }

  /**
   * Create a new execution.
   */
  async create(
    flowId: string,
    context: Record<string, unknown> = {},
    options?: { executionId?: string; tenantId?: string }
  ): Promise<Execution> {
    const flow = this.flows.get(flowId);
    if (!flow) {
      throw new ExecutionError('FLOW_NOT_FOUND', '', `Flow "${flowId}" not found`);
    }

    const execution: Execution = {
      id: options?.executionId ?? generateId(),
      flowId: flow.id,
      flowVersion: flow.version,
      currentStepId: flow.initialStepId,
      status: 'pending',
      context: { ...context },
      stepCount: 0,
      history: this.opts.recordHistory ? [] : undefined,
      createdAt: now(),
      updatedAt: now(),
      tenantId: options?.tenantId,
    };

    await this.store.save(execution);
    this.events?.onExecutionCreated?.({ executionId: execution.id, flowId, context });

    return execution;
  }

  /**
   * Execute one step. Call repeatedly until done.
   */
  async tick(executionId: string): Promise<TickResult> {
    const execution = await this.store.load(executionId);
    if (!execution) {
      return { done: true, status: 'failed', error: { code: 'NOT_FOUND', message: 'Execution not found' } };
    }

    // Already terminal
    if (execution.status === 'completed' || execution.status === 'failed') {
      return { done: true, status: execution.status };
    }

    // Waiting and not ready
    if (execution.status === 'waiting' && execution.wakeAt && execution.wakeAt > now()) {
      return { done: false, status: 'waiting', wakeAt: execution.wakeAt };
    }

    // Step limit
    if (execution.stepCount >= this.opts.maxSteps) {
      return this.fail(execution, 'MAX_STEPS', `Exceeded ${this.opts.maxSteps} steps`);
    }

    // Load flow
    const flow = this.flows.get(execution.flowId, execution.flowVersion);
    if (!flow) {
      return this.fail(execution, 'FLOW_NOT_FOUND', `Flow "${execution.flowId}" not found`);
    }

    // Get step
    const step = flow.steps[execution.currentStepId];
    if (!step) {
      return this.fail(execution, 'STEP_NOT_FOUND', `Step "${execution.currentStepId}" not found`);
    }

    // Get handler
    const handler = this.handlers.get(step.type);
    if (!handler) {
      return this.fail(execution, 'HANDLER_NOT_FOUND', `No handler for "${step.type}"`);
    }

    // Resolve input
    let input: unknown;
    try {
      input = resolveInput(step.input, execution.context);
    } catch (err) {
      return this.fail(execution, 'INPUT_ERROR', err instanceof Error ? err.message : 'Input resolution failed');
    }

    // Update to running
    const wasFirst = execution.status === 'pending';
    execution.status = 'running';
    execution.updatedAt = now();

    if (wasFirst) {
      this.events?.onExecutionStarted?.({ executionId: execution.id, flowId: flow.id, stepId: step.id });
    }
    this.events?.onStepStarted?.({ executionId: execution.id, stepId: step.id, input });

    // Execute handler
    const startTime = now();
    let result: StepResult;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.opts.timeoutMs);

      try {
        result = await handler.execute({
          input,
          step,
          context: execution.context,
          execution: { id: execution.id, flowId: flow.id, stepCount: execution.stepCount },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      result = {
        outcome: 'failure',
        error: { code: 'HANDLER_ERROR', message: err instanceof Error ? err.message : 'Handler threw' },
      };
    }

    const durationMs = now() - startTime;
    this.events?.onStepCompleted?.({ executionId: execution.id, stepId: step.id, result, durationMs });

    // Record history
    if (execution.history) {
      execution.history.push({
        stepId: step.id,
        handlerType: step.type,
        outcome: result.outcome,
        startedAt: startTime,
        completedAt: now(),
        durationMs,
        error: result.error,
      });
    }

    execution.stepCount++;

    // Apply result
    return this.applyResult(execution, flow, step, result);
  }

  /**
   * Run to completion. Use tick() for production.
   */
  async run(executionId: string, options?: { simulateTime?: boolean }): Promise<TickResult> {
    let result: TickResult;
    let iterations = 0;
    const maxIterations = 10000;

    do {
      result = await this.tick(executionId);

      if (result.status === 'waiting' && result.wakeAt && !options?.simulateTime) {
        const delay = result.wakeAt - now();
        if (delay > 0) await sleep(delay);
      }

      if (++iterations >= maxIterations) {
        throw new ExecutionError('MAX_ITERATIONS', executionId, 'Run exceeded max iterations');
      }
    } while (!result.done);

    return result;
  }

  /**
   * Cancel an execution.
   */
  async cancel(executionId: string, reason?: string): Promise<boolean> {
    const execution = await this.store.load(executionId);
    if (!execution) return false;
    if (execution.status === 'completed' || execution.status === 'failed') return false;

    execution.status = 'failed';
    execution.error = { code: 'CANCELLED', message: reason ?? 'Cancelled', stepId: execution.currentStepId, timestamp: now() };
    execution.updatedAt = now();

    await this.store.save(execution);
    this.events?.onExecutionFailed?.({ executionId, stepId: execution.currentStepId, error: execution.error });

    return true;
  }

  /**
   * Get execution by ID.
   */
  async get(executionId: string): Promise<Execution | null> {
    return this.store.load(executionId);
  }

  // --- Private ---

  private async fail(execution: Execution, code: string, message: string): Promise<TickResult> {
    execution.status = 'failed';
    execution.error = { code, message, stepId: execution.currentStepId, timestamp: now() };
    execution.updatedAt = now();
    await this.store.save(execution);
    this.events?.onExecutionFailed?.({ executionId: execution.id, stepId: execution.currentStepId, error: execution.error });
    return { done: true, status: 'failed', error: { code, message } };
  }

  private async applyResult(execution: Execution, flow: Flow, step: Step, result: StepResult): Promise<TickResult> {
    // Store output
    if (result.outcome === 'success' && step.outputKey && result.output !== undefined) {
      setPath(execution.context, step.outputKey, result.output);
    }

    if (result.outcome === 'success') {
      const next = result.nextStepOverride !== undefined ? result.nextStepOverride : step.transitions.onSuccess;

      if (next === null || next === undefined) {
        // Complete
        execution.status = 'completed';
        execution.updatedAt = now();
        await this.store.save(execution);
        this.events?.onExecutionCompleted?.({ executionId: execution.id, context: execution.context, totalSteps: execution.stepCount });
        return { done: true, status: 'completed', stepId: step.id, outcome: 'success' };
      }

      if (!flow.steps[next]) {
        return this.fail(execution, 'INVALID_TRANSITION', `Step "${step.id}" → "${next}" not found`);
      }

      execution.currentStepId = next;
      execution.updatedAt = now();
      await this.store.save(execution);
      return { done: false, status: 'running', stepId: step.id, outcome: 'success' };
    }

    if (result.outcome === 'failure') {
      const next = result.nextStepOverride !== undefined ? result.nextStepOverride : step.transitions.onFailure;

      if (next === null || next === undefined) {
        execution.status = 'failed';
        execution.error = {
          code: result.error?.code ?? 'STEP_FAILED',
          message: result.error?.message ?? 'Step failed',
          stepId: step.id,
          details: result.error?.details,
          timestamp: now(),
        };
        execution.updatedAt = now();
        await this.store.save(execution);
        this.events?.onExecutionFailed?.({ executionId: execution.id, stepId: step.id, error: execution.error });
        return { done: true, status: 'failed', stepId: step.id, outcome: 'failure', error: { code: execution.error.code, message: execution.error.message } };
      }

      if (!flow.steps[next]) {
        return this.fail(execution, 'INVALID_TRANSITION', `Step "${step.id}" onFailure → "${next}" not found`);
      }

      execution.currentStepId = next;
      execution.updatedAt = now();
      await this.store.save(execution);
      return { done: false, status: 'running', stepId: step.id, outcome: 'failure' };
    }

    // Wait
    execution.status = 'waiting';
    execution.wakeAt = result.wakeAt;
    execution.waitReason = result.waitReason;
    if (step.transitions.onResume) {
      execution.currentStepId = step.transitions.onResume;
    }
    execution.updatedAt = now();
    await this.store.save(execution);
    this.events?.onExecutionWaiting?.({ executionId: execution.id, stepId: step.id, wakeAt: result.wakeAt, reason: result.waitReason });
    return { done: false, status: 'waiting', stepId: step.id, outcome: 'wait', wakeAt: result.wakeAt };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
```

### src/engine/input-resolver.ts

```typescript
import type { InputSelector } from '../types/flow';

/**
 * Resolve input from context based on selector.
 */
export function resolveInput(selector: InputSelector, context: Record<string, unknown>): unknown {
  switch (selector.type) {
    case 'key':
      return context[selector.key];

    case 'keys': {
      const result: Record<string, unknown> = {};
      for (const k of selector.keys) {
        if (k in context) result[k] = context[k];
      }
      return result;
    }

    case 'path':
      return getPath(context, selector.path);

    case 'template':
      return interpolate(selector.template, context);

    case 'full':
      return { ...context };

    case 'static':
      return selector.value;
  }
}

function getPath(obj: unknown, path: string): unknown {
  let current: any = obj;
  for (const part of path.split('.')) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function interpolate(template: unknown, context: Record<string, unknown>): unknown {
  if (typeof template === 'string') {
    const full = template.match(/^\$\{([^}]+)\}$/);
    if (full) return getPath(context, full[1]);
    return template.replace(/\$\{([^}]+)\}/g, (_, p) => {
      const v = getPath(context, p);
      return v === undefined ? '' : String(v);
    });
  }

  if (Array.isArray(template)) {
    return template.map(t => interpolate(t, context));
  }

  if (template && typeof template === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(template)) {
      result[k] = interpolate(v, context);
    }
    return result;
  }

  return template;
}
```

### src/utils/index.ts

```typescript
export function generateId(): string {
  return crypto.randomUUID();
}

export function now(): number {
  return Date.now();
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current)) current[parts[i]] = {};
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}
```

### src/utils/validation.ts

```typescript
import type { Flow } from '../types/flow';
import type { ValidationIssue } from '../types/errors';

export function validateFlow(flow: Flow): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!flow.id) issues.push({ path: 'id', message: 'Required', severity: 'error' });
  if (!flow.version) issues.push({ path: 'version', message: 'Required', severity: 'error' });
  if (!flow.initialStepId) issues.push({ path: 'initialStepId', message: 'Required', severity: 'error' });

  const steps = Object.keys(flow.steps || {});
  if (steps.length === 0) {
    issues.push({ path: 'steps', message: 'At least one step required', severity: 'error' });
    return issues;
  }

  if (flow.initialStepId && !flow.steps[flow.initialStepId]) {
    issues.push({ path: 'initialStepId', message: `Step "${flow.initialStepId}" not found`, severity: 'error' });
  }

  for (const [id, step] of Object.entries(flow.steps)) {
    if (step.id !== id) {
      issues.push({ path: `steps.${id}.id`, message: `ID mismatch: "${step.id}" vs key "${id}"`, severity: 'error' });
    }
    if (!step.type) issues.push({ path: `steps.${id}.type`, message: 'Required', severity: 'error' });
    if (!step.input) issues.push({ path: `steps.${id}.input`, message: 'Required', severity: 'error' });

    const t = step.transitions;
    if (t?.onSuccess && !flow.steps[t.onSuccess]) {
      issues.push({ path: `steps.${id}.transitions.onSuccess`, message: `"${t.onSuccess}" not found`, severity: 'error' });
    }
    if (t?.onFailure && !flow.steps[t.onFailure]) {
      issues.push({ path: `steps.${id}.transitions.onFailure`, message: `"${t.onFailure}" not found`, severity: 'error' });
    }
    if (t?.onResume && !flow.steps[t.onResume]) {
      issues.push({ path: `steps.${id}.transitions.onResume`, message: `"${t.onResume}" not found`, severity: 'error' });
    }
  }

  return issues;
}
```

---

## 4.8 Built-in Implementations

### src/impl/memory-store.ts

```typescript
import type { Execution, ExecutionStatus } from '../types/execution';
import type { StateStore } from '../interfaces/state-store';

/**
 * In-memory store. For testing and single-instance use.
 */
export class MemoryStore implements StateStore {
  private data = new Map<string, Execution>();

  async load(id: string): Promise<Execution | null> {
    const e = this.data.get(id);
    return e ? structuredClone(e) : null;
  }

  async save(execution: Execution): Promise<void> {
    this.data.set(execution.id, structuredClone(execution));
  }

  async delete(id: string): Promise<boolean> {
    return this.data.delete(id);
  }

  async listWakeReady(now: number, limit = 100): Promise<string[]> {
    const ids: string[] = [];
    for (const e of this.data.values()) {
      if (e.status === 'waiting' && e.wakeAt && e.wakeAt <= now) {
        ids.push(e.id);
        if (ids.length >= limit) break;
      }
    }
    return ids;
  }

  async listByStatus(status: ExecutionStatus, limit = 100): Promise<Execution[]> {
    const results: Execution[] = [];
    for (const e of this.data.values()) {
      if (e.status === status) {
        results.push(structuredClone(e));
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  // Test helpers
  clear() { this.data.clear(); }
  count() { return this.data.size; }
}
```

### src/impl/handler-registry.ts

```typescript
import type { StepHandler } from '../interfaces/step-handler';
import type { HandlerRegistry } from '../interfaces/handler-registry';

export class DefaultHandlerRegistry implements HandlerRegistry {
  private handlers = new Map<string, StepHandler>();

  register(handler: StepHandler): void {
    if (this.handlers.has(handler.type)) {
      throw new Error(`Handler "${handler.type}" already registered`);
    }
    this.handlers.set(handler.type, handler);
  }

  registerAll(handlers: StepHandler[]): void {
    handlers.forEach(h => this.register(h));
  }

  get(type: string): StepHandler | undefined {
    return this.handlers.get(type);
  }

  has(type: string): boolean {
    return this.handlers.has(type);
  }

  types(): string[] {
    return [...this.handlers.keys()];
  }
}
```

### src/impl/flow-registry.ts

```typescript
import type { Flow } from '../types/flow';
import type { FlowRegistry } from '../interfaces/flow-registry';
import type { ValidationIssue } from '../types/errors';
import { FlowValidationError } from '../types/errors';
import { validateFlow } from '../utils/validation';

export class DefaultFlowRegistry implements FlowRegistry {
  private flows = new Map<string, Map<string, Flow>>();
  private latest = new Map<string, string>();

  register(flow: Flow): void {
    const issues = this.validate(flow);
    if (issues.some(i => i.severity === 'error')) {
      throw new FlowValidationError(flow.id, issues);
    }

    let versions = this.flows.get(flow.id);
    if (!versions) {
      versions = new Map();
      this.flows.set(flow.id, versions);
    }

    if (versions.has(flow.version)) {
      throw new Error(`Flow "${flow.id}@${flow.version}" already registered`);
    }

    versions.set(flow.version, flow);

    const current = this.latest.get(flow.id);
    if (!current || flow.version > current) {
      this.latest.set(flow.id, flow.version);
    }
  }

  get(id: string, version?: string): Flow | undefined {
    const versions = this.flows.get(id);
    if (!versions) return undefined;
    return version ? versions.get(version) : versions.get(this.latest.get(id)!);
  }

  has(id: string): boolean {
    return this.flows.has(id);
  }

  flowIds(): string[] {
    return [...this.flows.keys()];
  }

  validate(flow: Flow): ValidationIssue[] {
    return validateFlow(flow);
  }
}
```

---

## 4.9 Public Exports

### src/index.ts

```typescript
// Types
export type { Flow, Step, InputSelector, StepTransitions } from './types/flow';
export type { Execution, ExecutionStatus, ExecutionError, StepHistory } from './types/execution';
export type { StepResult, StepError } from './types/result';
export { Result } from './types/result';
export { FlowMonkeyError, FlowValidationError, ExecutionError } from './types/errors';
export type { ValidationIssue } from './types/errors';

// Interfaces
export type { StateStore } from './interfaces/state-store';
export type { StepHandler, HandlerParams } from './interfaces/step-handler';
export type { HandlerRegistry } from './interfaces/handler-registry';
export type { FlowRegistry } from './interfaces/flow-registry';
export type { EventBus } from './interfaces/event-bus';

// Engine
export { Engine, type EngineOptions, type TickResult } from './engine/execution-engine';
export { resolveInput } from './engine/input-resolver';

// Implementations
export { MemoryStore } from './impl/memory-store';
export { DefaultHandlerRegistry } from './impl/handler-registry';
export { DefaultFlowRegistry } from './impl/flow-registry';

// Utils
export { generateId, now } from './utils';
export { validateFlow } from './utils/validation';
```

### src/test.ts

```typescript
// Re-export everything
export * from './index';

// Test utilities (below)
export { TestHarness, type TestHarnessOptions, type RunResult } from '../test/harness';
export * from '../test/handlers';
export * from '../test/flows';
```

---

## 5. Testing

### test/harness.ts

```typescript
import { Engine, type EngineOptions, type TickResult } from '../src/engine/execution-engine';
import { MemoryStore } from '../src/impl/memory-store';
import { DefaultHandlerRegistry } from '../src/impl/handler-registry';
import { DefaultFlowRegistry } from '../src/impl/flow-registry';
import type { Flow } from '../src/types/flow';
import type { Execution } from '../src/types/execution';
import type { StepHandler } from '../src/interfaces/step-handler';
import type { EventBus } from '../src/interfaces/event-bus';

export interface TestHarnessOptions {
  handlers?: StepHandler[];
  flows?: Flow[];
  recordHistory?: boolean;
  maxSteps?: number;
}

export interface RunResult {
  execution: Execution;
  result: TickResult;
  events: any[];
}

/**
 * Test harness for easy testing.
 */
export class TestHarness {
  readonly store: MemoryStore;
  readonly handlers: DefaultHandlerRegistry;
  readonly flows: DefaultFlowRegistry;
  readonly engine: Engine;
  readonly events: any[] = [];

  constructor(options: TestHarnessOptions = {}) {
    this.store = new MemoryStore();
    this.handlers = new DefaultHandlerRegistry();
    this.flows = new DefaultFlowRegistry();

    const eventBus: EventBus = {
      onExecutionCreated: e => this.events.push({ type: 'created', ...e }),
      onExecutionStarted: e => this.events.push({ type: 'started', ...e }),
      onStepStarted: e => this.events.push({ type: 'step.started', ...e }),
      onStepCompleted: e => this.events.push({ type: 'step.completed', ...e }),
      onExecutionCompleted: e => this.events.push({ type: 'completed', ...e }),
      onExecutionFailed: e => this.events.push({ type: 'failed', ...e }),
      onExecutionWaiting: e => this.events.push({ type: 'waiting', ...e }),
    };

    this.engine = new Engine(this.store, this.handlers, this.flows, eventBus, {
      recordHistory: options.recordHistory ?? true,
      maxSteps: options.maxSteps ?? 100,
    });

    options.handlers?.forEach(h => this.handlers.register(h));
    options.flows?.forEach(f => this.flows.register(f));
  }

  /** Run a flow to completion */
  async run(flowId: string, context: Record<string, unknown> = {}): Promise<RunResult> {
    const execution = await this.engine.create(flowId, context);
    const result = await this.engine.run(execution.id, { simulateTime: true });
    const final = await this.engine.get(execution.id);
    return { execution: final!, result, events: this.events.filter(e => e.executionId === execution.id) };
  }

  /** Create without running */
  create(flowId: string, context: Record<string, unknown> = {}) {
    return this.engine.create(flowId, context);
  }

  /** Single tick */
  tick(executionId: string) {
    return this.engine.tick(executionId);
  }

  /** Reset all state */
  reset() {
    this.store.clear();
    this.events.length = 0;
  }

  // Assertions
  assertCompleted(e: Execution) {
    if (e.status !== 'completed') throw new Error(`Expected completed, got ${e.status}: ${e.error?.message}`);
  }

  assertFailed(e: Execution, code?: string) {
    if (e.status !== 'failed') throw new Error(`Expected failed, got ${e.status}`);
    if (code && e.error?.code !== code) throw new Error(`Expected code ${code}, got ${e.error?.code}`);
  }

  assertContext(e: Execution, expected: Record<string, unknown>) {
    for (const [k, v] of Object.entries(expected)) {
      if (JSON.stringify(e.context[k]) !== JSON.stringify(v)) {
        throw new Error(`Context[${k}]: expected ${JSON.stringify(v)}, got ${JSON.stringify(e.context[k])}`);
      }
    }
  }
}
```

### test/handlers.ts

```typescript
import type { StepHandler } from '../src/interfaces/step-handler';
import { Result } from '../src/types/result';

export const echoHandler: StepHandler = {
  type: 'echo',
  async execute({ input }) {
    return Result.success(input);
  },
};

export const transformHandler: StepHandler = {
  type: 'transform',
  async execute({ input, step }) {
    const s = String(input);
    switch (step.config.transform) {
      case 'upper': return Result.success(s.toUpperCase());
      case 'lower': return Result.success(s.toLowerCase());
      case 'reverse': return Result.success(s.split('').reverse().join(''));
      default: return Result.failure('BAD_TRANSFORM', `Unknown: ${step.config.transform}`);
    }
  },
};

export const delayHandler: StepHandler = {
  type: 'delay',
  async execute({ step }) {
    return Result.wait(step.config.ms as number, 'Delaying');
  },
};

export const failHandler: StepHandler = {
  type: 'fail',
  async execute({ step }) {
    return Result.failure(
      (step.config.code as string) ?? 'FAIL',
      (step.config.message as string) ?? 'Failed'
    );
  },
};

export const branchHandler: StepHandler = {
  type: 'branch',
  async execute({ context, step }) {
    const conditions = step.config.conditions as { path: string; eq: unknown; goto: string }[];
    for (const c of conditions) {
      if (getPath(context, c.path) === c.eq) {
        return { outcome: 'success', nextStepOverride: c.goto };
      }
    }
    const def = step.config.default as string | undefined;
    if (def) return { outcome: 'success', nextStepOverride: def };
    return Result.failure('NO_MATCH', 'No condition matched');
  },
};

export const setHandler: StepHandler = {
  type: 'set',
  async execute({ step }) {
    return Result.success(step.config.value);
  },
};

function getPath(obj: unknown, path: string): unknown {
  let c: any = obj;
  for (const p of path.split('.')) {
    if (c == null) return undefined;
    c = c[p];
  }
  return c;
}
```

### test/flows.ts

```typescript
import type { Flow } from '../src/types/flow';

export const simpleFlow: Flow = {
  id: 'simple',
  version: '1.0.0',
  initialStepId: 'echo',
  steps: {
    echo: {
      id: 'echo',
      type: 'echo',
      config: {},
      input: { type: 'key', key: 'message' },
      outputKey: 'echoed',
      transitions: { onSuccess: 'transform' },
    },
    transform: {
      id: 'transform',
      type: 'transform',
      config: { transform: 'upper' },
      input: { type: 'key', key: 'echoed' },
      outputKey: 'result',
      transitions: { onSuccess: null },
    },
  },
};

export const branchFlow: Flow = {
  id: 'branch',
  version: '1.0.0',
  initialStepId: 'check',
  steps: {
    check: {
      id: 'check',
      type: 'branch',
      config: {
        conditions: [
          { path: 'type', eq: 'a', goto: 'a' },
          { path: 'type', eq: 'b', goto: 'b' },
        ],
        default: 'default',
      },
      input: { type: 'full' },
      transitions: {},
    },
    a: { id: 'a', type: 'set', config: { value: 'handled-a' }, input: { type: 'static', value: null }, outputKey: 'result', transitions: { onSuccess: null } },
    b: { id: 'b', type: 'set', config: { value: 'handled-b' }, input: { type: 'static', value: null }, outputKey: 'result', transitions: { onSuccess: null } },
    default: { id: 'default', type: 'set', config: { value: 'handled-default' }, input: { type: 'static', value: null }, outputKey: 'result', transitions: { onSuccess: null } },
  },
};

export const waitFlow: Flow = {
  id: 'wait',
  version: '1.0.0',
  initialStepId: 'start',
  steps: {
    start: {
      id: 'start',
      type: 'echo',
      config: {},
      input: { type: 'key', key: 'message' },
      outputKey: 'started',
      transitions: { onSuccess: 'wait' },
    },
    wait: {
      id: 'wait',
      type: 'delay',
      config: { ms: 1000 },
      input: { type: 'static', value: null },
      transitions: { onSuccess: 'finish' },
    },
    finish: {
      id: 'finish',
      type: 'set',
      config: { value: 'done' },
      input: { type: 'static', value: null },
      outputKey: 'result',
      transitions: { onSuccess: null },
    },
  },
};

export const errorFlow: Flow = {
  id: 'error',
  version: '1.0.0',
  initialStepId: 'fail',
  steps: {
    fail: {
      id: 'fail',
      type: 'fail',
      config: { code: 'BOOM' },
      input: { type: 'full' },
      transitions: { onFailure: 'recover' },
    },
    recover: {
      id: 'recover',
      type: 'set',
      config: { value: 'recovered' },
      input: { type: 'static', value: null },
      outputKey: 'result',
      transitions: { onSuccess: null },
    },
  },
};
```

### test/engine.test.ts

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { TestHarness } from './harness';
import { echoHandler, transformHandler, delayHandler, failHandler, branchHandler, setHandler } from './handlers';
import { simpleFlow, branchFlow, waitFlow, errorFlow } from './flows';

describe('Engine', () => {
  let t: TestHarness;

  beforeEach(() => {
    t = new TestHarness({
      handlers: [echoHandler, transformHandler, delayHandler, failHandler, branchHandler, setHandler],
      flows: [simpleFlow, branchFlow, waitFlow, errorFlow],
    });
  });

  describe('simple flow', () => {
    it('runs to completion', async () => {
      const { execution } = await t.run('simple', { message: 'hello' });
      t.assertCompleted(execution);
      t.assertContext(execution, { echoed: 'hello', result: 'HELLO' });
      expect(execution.stepCount).toBe(2);
    });

    it('records history', async () => {
      const { execution } = await t.run('simple', { message: 'test' });
      expect(execution.history).toHaveLength(2);
      expect(execution.history![0].stepId).toBe('echo');
      expect(execution.history![1].stepId).toBe('transform');
    });
  });

  describe('branching', () => {
    it('takes branch a', async () => {
      const { execution } = await t.run('branch', { type: 'a' });
      t.assertCompleted(execution);
      t.assertContext(execution, { result: 'handled-a' });
    });

    it('takes branch b', async () => {
      const { execution } = await t.run('branch', { type: 'b' });
      t.assertCompleted(execution);
      t.assertContext(execution, { result: 'handled-b' });
    });

    it('takes default', async () => {
      const { execution } = await t.run('branch', { type: 'x' });
      t.assertCompleted(execution);
      t.assertContext(execution, { result: 'handled-default' });
    });
  });

  describe('wait/resume', () => {
    it('handles wait', async () => {
      const { execution } = await t.run('wait', { message: 'hi' });
      t.assertCompleted(execution);
      t.assertContext(execution, { started: 'hi', result: 'done' });
    });

    it('tick returns waiting', async () => {
      const e = await t.create('wait', { message: 'hi' });
      await t.tick(e.id); // echo
      const r = await t.tick(e.id); // delay → wait
      expect(r.status).toBe('waiting');
      expect(r.wakeAt).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('follows onFailure', async () => {
      const { execution } = await t.run('error', {});
      t.assertCompleted(execution);
      t.assertContext(execution, { result: 'recovered' });
    });
  });

  describe('cancellation', () => {
    it('cancels execution', async () => {
      const e = await t.create('wait', { message: 'hi' });
      await t.tick(e.id);
      await t.tick(e.id); // waiting

      const ok = await t.engine.cancel(e.id, 'test');
      expect(ok).toBe(true);

      const final = await t.engine.get(e.id);
      t.assertFailed(final!, 'CANCELLED');
    });
  });
});
```

---

## 6. Developer Workflow

### 6.1 Getting Started

```bash
# Clone
git clone https://github.com/your-org/flowmonkey.git
cd flowmonkey

# Install
pnpm install

# Test
pnpm test

# Build
pnpm build
```

### 6.2 Development

```bash
# Watch mode (rebuilds on change)
pnpm dev

# Test watch mode
pnpm test:watch

# Type check
pnpm typecheck
```

### 6.3 Adding a New Package

```bash
mkdir packages/redis
cd packages/redis

# Create package.json
cat > package.json << 'EOF'
{
  "name": "@flowmonkey/redis",
  "version": "0.0.1",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "dependencies": {
    "@flowmonkey/core": "workspace:*",
    "ioredis": "^5.0.0"
  }
}
EOF
```

### 6.4 Publishing

```bash
# Build all
pnpm build

# Publish (from package dir)
cd packages/core
npm publish --access public
```

---

## 7. Future Packages

### @flowmonkey/redis

```typescript
import type { StateStore } from '@flowmonkey/core';
import Redis from 'ioredis';

export class RedisStore implements StateStore {
  constructor(private redis: Redis) {}
  // ... implementation
}
```

### @flowmonkey/handlers

```typescript
import { Result, type StepHandler } from '@flowmonkey/core';

export const httpHandler: StepHandler = {
  type: 'http',
  async execute({ step }) {
    const res = await fetch(step.config.url as string, { ... });
    return Result.success(await res.json());
  },
};
```

### @flowmonkey/agents

```typescript
import { Result, type StepHandler } from '@flowmonkey/core';

export const llmHandler: StepHandler = {
  type: 'llm.invoke',
  async execute({ input, step }) {
    const response = await anthropic.messages.create({ ... });
    return Result.success(response.content);
  },
};

export const mcpHandler: StepHandler = {
  type: 'mcp.tool',
  async execute({ input, step }) {
    // Call MCP tool
  },
};
```

---

## Appendix: Implementation Checklist

### Phase 1: Setup
- [ ] Create repo with folder structure
- [ ] Root `package.json`, `pnpm-workspace.yaml`
- [ ] `tsconfig.base.json`
- [ ] `vitest.workspace.ts`
- [ ] `.gitignore`, `.npmrc`

### Phase 2: Core Types
- [ ] `packages/core/src/types/flow.ts`
- [ ] `packages/core/src/types/execution.ts`
- [ ] `packages/core/src/types/result.ts`
- [ ] `packages/core/src/types/errors.ts`

### Phase 3: Interfaces
- [ ] `packages/core/src/interfaces/state-store.ts`
- [ ] `packages/core/src/interfaces/step-handler.ts`
- [ ] `packages/core/src/interfaces/handler-registry.ts`
- [ ] `packages/core/src/interfaces/flow-registry.ts`
- [ ] `packages/core/src/interfaces/event-bus.ts`

### Phase 4: Engine
- [ ] `packages/core/src/utils/index.ts`
- [ ] `packages/core/src/utils/validation.ts`
- [ ] `packages/core/src/engine/input-resolver.ts`
- [ ] `packages/core/src/engine/execution-engine.ts`

### Phase 5: Implementations
- [ ] `packages/core/src/impl/memory-store.ts`
- [ ] `packages/core/src/impl/handler-registry.ts`
- [ ] `packages/core/src/impl/flow-registry.ts`

### Phase 6: Exports
- [ ] `packages/core/src/index.ts`
- [ ] `packages/core/src/test.ts`

### Phase 7: Testing
- [ ] `packages/core/test/harness.ts`
- [ ] `packages/core/test/handlers.ts`
- [ ] `packages/core/test/flows.ts`
- [ ] `packages/core/test/engine.test.ts`

### Phase 8: Package Config
- [ ] `packages/core/package.json`
- [ ] `packages/core/tsconfig.json`
- [ ] `packages/core/tsup.config.ts`
- [ ] `packages/core/vitest.config.ts`
- [ ] `packages/core/README.md`

---

**End of Specification**
