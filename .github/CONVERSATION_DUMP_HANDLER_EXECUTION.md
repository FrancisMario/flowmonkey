# FlowMonkey Handler Execution Architecture - Conversation Dump

**Date:** February 4, 2026  
**Purpose:** Continue this conversation in another AI chatbot  
**To Resume:** Paste this entire file as context, then ask your follow-up question

---

## Conversation Summary

We've been discussing **handler execution isolation and architecture** for FlowMonkey, a TypeScript workflow engine. The goal is to evolve from the current in-process execution model to a distributed, isolated worker system suitable for a **marketplace of handlers**.

### Key Decisions Made:

1. **Current state:** All handlers are trusted, run in-process (no changes for now)
2. **Future vision:** Distributed workers with isolation for marketplace handlers
3. **Two execution modes:** Stateless (60s TTL, sandboxed) vs Stateful (variable TTL, containerized)
4. **Dependency caching:** Multi-layer image strategy to avoid npm install delays

---

## Current FlowMonkey Architecture

### Stateless Engine Pattern
```
Engine (stateless) → creates/mutates → Execution (mutable state in StateStore)
```

### Key Packages
- `packages/core` — Engine, types, interfaces, MemoryStore, TestHarness
- `packages/handlers` — Function-based and class-based handlers
- `packages/jobs` — Stateful handler job runner (claim/process/complete)
- `packages/postgres` / `packages/redis` — Production stores

### Handler Execution Today (In-Process)
```typescript
// In execution-engine.ts
result = await handler.execute({
  input, step, context, ctx, execution, tokenManager, signal
});
// ⚠️ Runs in same process - full system access, no isolation
```

---

## The Problem We're Solving

1. **Security:** Handlers have full Node.js runtime access (can crash engine, access secrets)
2. **Marketplace:** Can't safely run untrusted community handlers
3. **Dynamic Code Execution:** `new Function()` in transform/batch handlers is unsafe
4. **No Resource Limits:** Infinite loops consume all CPU/memory

---

## Proposed Solution: Two Execution Modes

### 1. Stateless Execution Mode

| Property | Value |
|----------|-------|
| **Max TTL** | 60 seconds (fixed, non-negotiable) |
| **Isolation** | Child process + sandbox |
| **Billing** | Per execution (fixed price) |
| **Checkpoints** | None |
| **Dependencies** | Pre-bundled only |
| **Use Cases** | HTTP calls, transforms, validations |

**Isolation Strategy:**
```typescript
// Fork child process with resource limits
const child = fork('./worker-sandbox.js', [], {
  execArgv: [`--max-old-space-size=512`],  // Memory limit
  env: this.buildSandboxEnv(task),  // Isolated environment
  timeout: ttl,  // Kill after TTL
});
```

**Sandbox Restrictions:**
- No `require()` for arbitrary modules
- No `process.exit`, `process.kill`
- Limited `fetch()` (no internal IPs)
- No `setInterval` (only limited `setTimeout`)
- Isolated environment variables

### 2. Stateful Execution Mode

| Property | Value |
|----------|-------|
| **Min TTL** | 60 seconds |
| **Max TTL** | Configurable (dev sets hard kill TTL) |
| **Default TTL** | 1 hour |
| **Isolation** | Container (Docker/lightweight) |
| **Billing** | Per-second (compute time) |
| **Checkpoints** | Required every 30s |
| **Pause/Sleep** | Supported (stops billing) |
| **Use Cases** | Video processing, ML, long tasks |

**TTL Configuration in Handler Manifest:**
```json
{
  "handler": {
    "type": "video-processor",
    "mode": "stateful"
  },
  "execution": {
    "ttl": {
      "soft": 3600000,
      "hard": 86400000,
      "default": 1800000
    },
    "checkpoint": {
      "required": true,
      "intervalMs": 30000
    }
  }
}
```

**Pause API (Billing Optimization):**
```typescript
// Handler can pause to reduce billing
if (await this.needsExternalData(frame)) {
  await pause.wait({
    reason: 'waiting-for-upload',
    maxWait: 3600_000,
    resumeOn: { event: 'upload.complete', filter: { frameId: frame } }
  });
  // Billing STOPS during pause
}
```

---

## The Dependency Problem & Solution

### Problem
```
Cold start WITHOUT caching:
1. Pull container image     → 10-30s
2. npm install dependencies → 30-120s  ← THIS IS THE PROBLEM
3. Start handler            → 1-2s
Total: 41-152 seconds 😱
```

### Solution: Multi-Layer Image Caching

```
Layer 1: Base Runtime Images (SLOW CHANGE)
┌───────────────────────────────────────────────────────────────┐
│ flowmonkey/runtime-node20:latest          (~150MB)            │
│ flowmonkey/runtime-node20-ffmpeg:latest   (~800MB)            │
│ flowmonkey/runtime-node20-sharp:latest    (~250MB)            │
│ flowmonkey/runtime-node20-puppeteer:latest (~1.2GB)           │
│                                                               │
│ Pre-built, pushed to registry, updated weekly/monthly         │
└───────────────────────────────────────────────────────────────┘
                       ↓ extends

Layer 2: Handler Bundle Image (MEDIUM CHANGE)
┌───────────────────────────────────────────────────────────────┐
│ marketplace/video-processor:1.0.0                             │
│                                                               │
│ FROM flowmonkey/runtime-node20-ffmpeg:latest                  │
│ COPY handler-bundle.js /app/                                  │
│ COPY node_modules /app/node_modules  ← PRE-INSTALLED          │
│                                                               │
│ Built at publish time, ~50-200MB delta                        │
└───────────────────────────────────────────────────────────────┘
                       ↓ runs

Layer 3: Execution Instance (FAST)
┌───────────────────────────────────────────────────────────────┐
│ Container starts with everything pre-loaded                   │
│ Only injects: task data, secrets, context                     │
│                                                               │
│ Cold start: 3-7 seconds                                       │
│ Warm start: <100ms                                            │
└───────────────────────────────────────────────────────────────┘
```

### Base Image Selection Logic
```typescript
private selectBaseImage(manifest: Manifest, deps: Dependencies): string {
  const needs = {
    ffmpeg: deps.has('ffmpeg-static') || deps.has('fluent-ffmpeg'),
    sharp: deps.has('sharp'),
    puppeteer: deps.has('puppeteer'),
    python: manifest.runtime === 'python',
  };
  
  if (needs.puppeteer) return 'flowmonkey/runtime-node20-puppeteer:latest';
  if (needs.ffmpeg) return 'flowmonkey/runtime-node20-ffmpeg:latest';
  if (needs.sharp) return 'flowmonkey/runtime-node20-sharp:latest';
  if (needs.python) return 'flowmonkey/runtime-python311:latest';
  return 'flowmonkey/runtime-node20:latest';
}
```

### Warm Pool Strategy
```typescript
class WarmPool {
  // Keep pre-warmed containers ready for instant execution
  // Cold start: 3-10s → Warm start: <100ms
  
  async acquire(handlerType: string): Promise<Container> {
    const pool = this.pools.get(handlerType) || [];
    
    if (pool.length > 0) {
      // Warm container available - instant!
      const container = pool.shift()!;
      this.replenishPool(handlerType);  // Background replenish
      return container;
    }
    
    // No warm container - cold start
    return this.startWarmContainer(handlerType);
  }
}
```

---

## Existing Jobs Package Analysis

The `packages/jobs` package already provides **80% of the primitives needed**:

### Current Components
- **JobStore interface** — create/claim/complete/fail jobs
- **JobRunner** — polls and executes jobs with concurrency
- **JobReaper** — cleans stale jobs
- **CheckpointManager** — save/load checkpoints, validate instance ownership
- **Heartbeat system** — prove worker is alive

### What's Missing (Gaps)
| Feature | Current | Needed |
|---------|---------|--------|
| Task Queue | ❌ Not implemented | ✅ Redis queue |
| Task Dispatch | ❌ Engine creates job directly | ✅ Engine → Queue → Worker |
| Result Collection | ❌ In-process callback | ✅ Result queue |
| Worker Runtime | ❌ Runner IS the worker | ✅ Separate process |
| Context Passing | ❌ In-memory reference | ✅ Serialized in task |
| Secrets Handling | ❌ Not implemented | ✅ Vault integration |

### Proposed Package Structure
```
packages/jobs/
├── src/
│   ├── types/
│   │   ├── job.ts              # Job, JobStatus, JobResult
│   │   ├── task.ts             # 🆕 Task message format
│   │   ├── result.ts           # 🆕 Result message format
│   │   └── worker.ts           # 🆕 Worker configuration
│   │
│   ├── interfaces/
│   │   ├── job-store.ts        # JobStore interface
│   │   ├── task-queue.ts       # 🆕 TaskQueue interface
│   │   └── worker-runtime.ts   # 🆕 WorkerRuntime interface
│   │
│   ├── runner/
│   │   ├── job-runner.ts       # Refactored to implement WorkerRuntime
│   │   ├── checkpoint-manager.ts
│   │   └── heartbeat-manager.ts
│   │
│   ├── dispatcher/             # 🆕
│   │   ├── task-dispatcher.ts  # Engine → Queue
│   │   └── result-collector.ts # Queue → Engine
│   │
│   └── serialization/          # 🆕
│       ├── task-serializer.ts
│       └── context-serializer.ts
```

---

## Core Types to Add

### Task Type (Engine → Worker)
```typescript
interface Task {
  taskId: string;
  executionId: string;
  flowId: string;
  stepId: string;
  
  handler: { type: string; version?: string };
  
  input: unknown;
  context: Record<string, unknown>;
  
  config: {
    timeout: number;
    retries: number;
  };
  
  metadata: {
    tenantId?: string;
    priority?: 'high' | 'normal' | 'low';
    dispatchedAt: string;
  };
}

interface StatefulTask extends Task {
  jobId: string;
  checkpoint?: { id: string; savedAt: string };
  heartbeatInterval: number;
}
```

### TaskResult Type (Worker → Engine)
```typescript
interface TaskResult {
  taskId: string;
  executionId: string;
  stepId: string;
  
  outcome: 'success' | 'failure' | 'wait' | 'error';
  
  output?: unknown;
  failure?: { code: string; message: string; retryable: boolean };
  error?: { message: string; stack?: string };
  wait?: { resumeToken: string; waitMs?: number };
  
  contextUpdates?: Record<string, unknown>;
  
  metrics: {
    startedAt: string;
    completedAt: string;
    durationMs: number;
    workerId: string;
  };
}
```

### TaskQueue Interface
```typescript
interface TaskQueue {
  push(task: Task): Promise<void>;
  pull(handlerType: string, timeoutMs?: number): Promise<Task | null>;
  ack(taskId: string): Promise<void>;
  nack(taskId: string, options?: { requeue?: boolean; delay?: number }): Promise<void>;
  depth(handlerType: string): Promise<number>;
}
```

### StatelessExecutionConfig
```typescript
interface StatelessExecutionConfig {
  mode: 'stateless';
  ttl: number;           // Max 60_000ms (60s), enforced
  memory: number;        // Max 512MB default, up to 1GB
  cpu: number;           // Max 1 core
  sandbox: {
    network: boolean;    // Allow network access (default: true)
    filesystem: 'none' | 'readonly' | 'temp';
    env: 'isolated' | 'inherit';
  };
}
```

### StatefulExecutionConfig
```typescript
interface StatefulExecutionConfig {
  mode: 'stateful';
  ttl: {
    soft: number;        // Warns developer, can extend
    hard: number;        // KILL no matter what (safety)
    default: number;     // If not specified
  };
  checkpoint: {
    required: true;
    intervalMs: number;
    maxSize: number;
  };
  pause: {
    enabled: true;
    maxPauseDuration: number;
  };
}
```

---

## Billing Models

### Stateless Billing
```typescript
interface StatelessBilling {
  mode: 'per-execution';
  tiers: {
    small:  { memory: 256,  cpu: 0.5, price: 0.0001 };  // $0.0001/execution
    medium: { memory: 512,  cpu: 1.0, price: 0.0003 };  // $0.0003/execution
    large:  { memory: 1024, cpu: 2.0, price: 0.0008 };  // $0.0008/execution
  };
}
// Example: 1M executions/month on medium = $300/month
```

### Stateful Billing
```typescript
interface StatefulBilling {
  mode: 'compute-time';
  rates: {
    'light':  { cpu: 0.5, memory: '512Mi',  rate: 0.00001 };   // $0.036/hour
    'medium': { cpu: 1.0, memory: '1Gi',    rate: 0.00003 };   // $0.108/hour
    'heavy':  { cpu: 2.0, memory: '4Gi',    rate: 0.0001 };    // $0.36/hour
    'gpu':    { cpu: 4.0, memory: '16Gi',   rate: 0.0005 };    // $1.80/hour
  };
  pausedRate: 0;  // Paused time = $0
}
// Example: 10h video job on 'heavy', 8h active + 2h paused
// = 8 × $0.36 + 0 = $2.88 (vs $3.60 without pause)
```

---

## Implementation Phases

### Phase 1: Stateless Execution (Week 1-2)
- Child process executor with sandbox
- 60s TTL enforcement
- Memory/CPU limits via Node.js flags
- Basic network sandboxing
- Per-execution billing model

### Phase 2: Handler Bundling (Week 3-4)
- Handler manifest schema
- esbuild bundler integration
- Base image selection logic
- Dockerfile generation
- Image build pipeline

### Phase 3: Container Execution (Week 5-6)
- Container runtime integration (Docker/containerd)
- Image pull and caching
- Resource limits (CPU, memory, GPU)
- Health checks
- Container cleanup

### Phase 4: Warm Pool (Week 7-8)
- Warm pool manager
- Container recycling
- Pool size auto-scaling
- Image pre-warming
- Cold start metrics

### Phase 5: Stateful Features (Week 9-10)
- Checkpoint API
- Pause/resume API
- Variable TTL with hard kill
- Compute-time billing
- Progress tracking

---

## External Context: AFH CLI Tool

You built a **handler development CLI** (`handler_dev` / `afh`) with these patterns:

### Child Process Isolation (Dev Mode)
```typescript
const child = spawn('npx', ['tsx', runnerPath], {
  cwd: projectDir,
  env: {
    ...process.env,
    AFH_TEST_VALUES: JSON.stringify(options.testValues),
    AFH_INPUTS: JSON.stringify(options.inputs),
  },
  shell: true,
});
```

### @TestValue Decorator Pattern
```typescript
@Input({ type: 'string', source: 'vault', required: true })
@TestValue(process.env.API_KEY!)  // ← Stripped in production builds
apiKey!: string;
```

### Production Build Process
- TypeScript AST manipulation to strip `@TestValue` decorators
- esbuild bundling + Terser minification
- Security scan for leaked secrets
- Output: `.afh` file (ZIP archive)

### Handler Manifest
```json
{
  "$schema": "https://agenticflow.com/schemas/handler-manifest-v1.json",
  "handler": {
    "type": "my-handler",
    "category": "integration",
    "stateful": false,
    "timeout": 30000
  },
  "inputs": [
    { "property": "apiKey", "type": "string", "source": "vault", "secret": true }
  ]
}
```

---

## Related Documents in Repo

1. **`.github/copilot-instructions.md`** — Comprehensive AI agent guide (668 lines)
2. **`.github/DISTRIBUTED_HANDLER_ARCHITECTURE.md`** — Full distributed worker architecture
3. **`.github/HANDLER_ARCHITECTURE_ANALYSIS.md`** — Security analysis and AFH CLI patterns

---

## Open Questions / Next Steps

When resuming this conversation, you might want to:

1. **Start implementing Phase 1** (stateless executor with child process sandbox)
2. **Design the handler manifest schema** in more detail
3. **Create base image Dockerfiles** for common runtimes
4. **Implement the warm pool manager**
5. **Write billing calculation logic**
6. **Discuss multi-region deployment** (documented in DISTRIBUTED_HANDLER_ARCHITECTURE.md)

---

## How to Resume

Paste this entire file into your AI chatbot, then ask something like:

- "Let's continue discussing FlowMonkey handler execution. I want to start implementing the stateless executor."
- "What's the simplest POC I can build to test the child process isolation pattern?"
- "Help me create the handler manifest JSON schema."
- "Let's design the TaskQueue interface for Redis."

The AI should have full context to continue the discussion.

---

**Last Updated:** February 4, 2026  
**Conversation Length:** ~15 exchanges  
**Key Files Created/Updated:**
- `.github/copilot-instructions.md` (updated with security section)
- `.github/HANDLER_ARCHITECTURE_ANALYSIS.md` (new)
- `.github/DISTRIBUTED_HANDLER_ARCHITECTURE.md` (new)
- `.github/CONVERSATION_DUMP_HANDLER_EXECUTION.md` (this file)
