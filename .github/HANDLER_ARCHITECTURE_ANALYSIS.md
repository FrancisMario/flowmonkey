# Handler Architecture Analysis & Isolation Strategy

**Date:** February 3, 2026  
**Context:** Analysis of existing handler development patterns and security implications for FlowMonkey

## Executive Summary

This document analyzes the handler execution architecture in FlowMonkey and related projects (`@agenticflow/cli` and handler implementations) to inform decisions about handler isolation, security, and development workflows.

**Key Finding:** FlowMonkey handlers currently execute **in-process with NO sandboxing**, presenting security risks for untrusted code. The AFH CLI demonstrates a proven pattern for **child process isolation** during development that could be adapted for production use.

---

## Table of Contents

1. [Current FlowMonkey Handler Model](#current-flowmonkey-handler-model)
2. [AFH CLI Architecture](#afh-cli-architecture)
3. [Handler Development Pattern](#handler-development-pattern)
4. [Security Analysis](#security-analysis)
5. [Proposed Improvements](#proposed-improvements)
6. [Implementation Roadmap](#implementation-roadmap)

---

## Current FlowMonkey Handler Model

### Execution Pipeline (Stateless Handlers)

```typescript
// From packages/core/src/engine/execution-engine.ts:270-310

// Execute handler
const startTime = now();
let result: StepResult;

try {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), this.opts.timeoutMs);

  try {
    const ctx = new ContextHelpersImpl(
      execution.id,
      execution.context,
      undefined, // storage
      undefined, // config
      this.opts.contextLimits
    );
    result = await handler.execute({
      input,
      step,
      context: execution.context,
      ctx,
      execution: execution,
      tokenManager: this.tokenManager,
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
```

**Characteristics:**
- ⚠️ **In-process execution** - Same Node.js process as engine
- ✅ **Timeout protection** - AbortController with 30s default
- ✅ **Context size limits** - Prevents memory bombs
- ✅ **Step count limits** - Prevents infinite loops
- ❌ **No process isolation** - Full runtime access
- ❌ **No CPU/memory quotas** - Can consume unlimited resources
- ❌ **No syscall filtering** - Can access filesystem, network, etc.

### Dynamic Code Execution (⚠️ High Risk)

**Two handlers use `new Function()` for user expressions:**

1. **TransformHandler** (`packages/handlers/src/class/transform.ts:60`)
```typescript
async execute(): Promise<StepResult> {
  try {
    // ⚠️ User expression executed with full privileges
    const fn = new Function('input', 'context', `return (${this.expression})`);
    const result = fn(this.data, this.context.context);
    return this.success({ result, transformedAt: Date.now() });
  } catch (error) {
    return this.failure('TRANSFORM_ERROR', (error as Error).message, {
      code: 'TRANSFORM_ERROR',
      message: (error as Error).message,
      input: this.data,
    });
  }
}
```

2. **BatchProcessHandler** (`packages/handlers/src/class/batch-process.ts:136`)
```typescript
// Create the transform function
let transformFn: (item: unknown, index: number) => unknown;
try {
  // ⚠️ User expression executed per batch item
  transformFn = new Function('item', 'index', `return (${this.expression})`) as typeof transformFn;
} catch (error) {
  return this.failure('INVALID_EXPRESSION', `Invalid expression: ${(error as Error).message}`, {
    code: 'INVALID_EXPRESSION',
    message: `Invalid expression: ${(error as Error).message}`,
    processedCount: checkpointData.processedCount,
    failedCount: checkpointData.failedCount,
  });
}
```

**Security Implications:**
- User-provided expressions have full Node.js access
- Can `require()` any module
- Can access filesystem, network, process, environment
- Can crash entire engine process
- No validation or sanitization beyond syntax errors

### Trust Model

```
┌─────────────────────────────────────────────────────────────┐
│ Trust Boundary                                              │
├─────────────────────────────────────────────────────────────┤
│ Trusted (Full System Access)                                │
│  ├─ Handler Implementations                                 │
│  ├─ Engine Core                                             │
│  └─ Dependencies                                            │
├─────────────────────────────────────────────────────────────┤
│ Configuration (Safe)                                        │
│  ├─ Flow Definitions (JSON)                                 │
│  ├─ Step Configurations                                     │
│  └─ Input Selectors                                         │
├─────────────────────────────────────────────────────────────┤
│ Untrusted (⚠️ Currently Has Full Access)                   │
│  ├─ User Expressions (transform/batch handlers)            │
│  └─ Dynamic Handler Registration (if allowed)              │
└─────────────────────────────────────────────────────────────┘
```

---

## AFH CLI Architecture

### Project Structure

**Handler Project** (created by `afh init`):
```
handler-project/
├── manifest.json          # Handler metadata (JSON Schema based)
├── package.json          # Dependencies + AFH scripts
├── src/
│   ├── index.ts          # Handler implementation
│   └── utils.ts          # Dev-only utilities (stripped in builds)
├── docs/
│   └── README.md         # Handler documentation
├── assets/
│   └── icon.png          # Handler icon (256x256)
└── .env                  # Local secrets (gitignored)
```

**AFH CLI Tool** (`@agenticflow/cli`):
```
handler_dev/
├── src/
│   ├── cli/              # Commander.js commands
│   │   ├── init.ts       # Project scaffolding
│   │   ├── dev.ts        # Development server
│   │   ├── build.ts      # Production packager
│   │   └── test.ts       # Testing utilities
│   ├── dev/              # Development server
│   │   ├── server.ts     # Express + WebSocket API
│   │   ├── executor.ts   # Handler execution (child process)
│   │   ├── extractor.ts  # AST parsing for @TestValue
│   │   └── ui/           # React dev UI (Vite)
│   ├── builder/          # Production build pipeline
│   │   ├── stripper.ts   # AST manipulation (remove @TestValue)
│   │   ├── bundler.ts    # Code bundling
│   │   ├── security.ts   # Secret scanning
│   │   └── packager.ts   # .afh file creation
│   └── templates/        # Handler scaffolding templates
└── dist/                 # Built artifacts
```

### Handler Development Pattern

**1. Handler Implementation with @TestValue:**

```typescript
import { Handler, Input, StatelessHandler, StepResult } from '@flowmonkey/core';
import { TestValue } from './utils'; // ← Local re-export, stripped at build

@Handler({
  type: 'timeout-tester',
  name: 'Timeout Tester',
  category: 'external',
})
export class TimeoutTester extends StatelessHandler<Input, Output> {
  
  @Input({
    type: 'number',
    source: 'config',
    required: true,
    description: 'Number of seconds to run the handler'
  })
  @TestValue(5)  // ← Provides default value during development
  runTimeSeconds!: number;

  async execute(): Promise<StepResult> {
    // Handler logic here
    return this.success({
      result: `Handler survived ${this.runTimeSeconds} seconds`,
      status: 'completed',
      actualRunTimeMs: Date.now() - startTime
    });
  }
}

// Export singleton instance
export default new TimeoutTester();
```

**2. @TestValue Decorator** (from `utils.ts`):

```typescript
/**
 * @TestValue decorator - provides default values for handler inputs during development.
 *
 * Use this to set test values that will be used when running `afh dev`.
 * These decorators are automatically stripped from production builds.
 */
export function TestValue(value: any): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    // Store test values on the constructor for runtime access during development
    if (!target.constructor.__testValues) {
      target.constructor.__testValues = {};
    }
    target.constructor.__testValues[propertyKey] = value;
  };
}
```

**Key Benefits:**
- ✅ No external dependencies for production
- ✅ Clean separation of dev/prod code
- ✅ Type-safe test values
- ✅ Supports environment variables: `@TestValue(process.env.API_KEY!)`

### Child Process Isolation (Dev Mode)

**Handler Executor** (`src/dev/executor.ts`):

```typescript
export async function executeHandler(
  projectDir: string,
  options: ExecutionOptions
): Promise<ExecutionResult> {
  const startTime = Date.now();
  const logs: string[] = [];

  // Create a temporary runner script
  const runnerCode = generateRunnerScript(projectDir, options);
  const tempDir = path.join(os.tmpdir(), 'afh-runner');
  const runnerId = `runner-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const runnerPath = path.join(tempDir, `${runnerId}.ts`);

  fs.writeFileSync(runnerPath, runnerCode);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeout = options.timeout || 30000;

    // Run with tsx in child process
    const child: ChildProcess = spawn('npx', ['tsx', runnerPath], {
      cwd: projectDir,
      env: {
        ...process.env,
        AFH_TEST_VALUES: JSON.stringify(options.testValues),
        AFH_INPUTS: JSON.stringify(options.inputs),
      },
      shell: true,
    });

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');  // ← Kill process on timeout
    }, timeout);

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      // Parse result from stdout
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timeoutId);
      fs.unlinkSync(runnerPath); // Clean up temp file

      if (timedOut) {
        resolve({
          success: false,
          duration: Date.now() - startTime,
          error: { message: `Execution timed out after ${timeout}ms`, code: 'TIMEOUT' },
          logs,
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Parse result and resolve
    });
  });
}
```

**Generated Runner Script:**

```typescript
function generateRunnerScript(projectDir: string, options: ExecutionOptions): string {
  return `
// Auto-generated runner script for AFH dev server
import handler from '${srcPath}';

const testValues = JSON.parse(process.env.AFH_TEST_VALUES || '{}');
const inputs = JSON.parse(process.env.AFH_INPUTS || '{}');

// Mock CheckpointManager for stateful handlers
class MockCheckpointManager {
  private data: any = null;

  async save(instanceId: string, data: any): Promise<void> {
    this.data = { data, savedAt: Date.now(), instanceId };
    console.log('[checkpoint:save]', JSON.stringify(data));
  }

  async load(jobId: string): Promise<any> {
    return this.data;
  }

  async clear(jobId: string): Promise<void> {
    this.data = null;
  }
}

// Mock StatefulHandlerContext
function createMockContext() {
  const checkpointManager = new MockCheckpointManager();

  return {
    executionId: 'dev-execution-' + Date.now(),
    stepId: 'dev-step-1',
    flowId: 'dev-flow',
    checkpoints: checkpointManager,
    instanceId: 'dev-instance-' + Date.now(),
    jobId: 'dev-job-' + Date.now(),
    isActive: async () => true,
    updateProgress: async (percent: number, message?: string) => {
      console.log('[progress]', percent + '%', message || '');
    }
  };
}

async function run() {
  try {
    const instance = handler as any;

    // Inject mock context for stateful handlers
    instance._context = createMockContext();

    // Apply test values first (as defaults)
    for (const [key, value] of Object.entries(testValues)) {
      if (key in instance) {
        instance[key] = value;
      }
    }

    // Apply inputs (override test values)
    for (const [key, value] of Object.entries(inputs)) {
      if (value !== undefined && value !== '') {
        instance[key] = value;
      }
    }

    // Execute the handler
    const result = await instance.execute();

    // Output result in parseable format
    console.log('__AFH_RESULT__:' + JSON.stringify({
      success: result?.outcome !== 'failure',
      output: result?.output || result,
      error: result?.outcome === 'failure' ? {
        code: result.error?.code,
        message: result.error?.message,
        details: result.error?.details
      } : undefined
    }));

  } catch (error) {
    console.log('__AFH_RESULT__:' + JSON.stringify({
      success: false,
      error: {
        code: 'EXECUTION_ERROR',
        message: error instanceof Error ? error.message : String(error)
      }
    }));
    process.exit(1);
  }
}

run();
`;
}
```

**Isolation Benefits:**
- ✅ **Process isolation** - Handler crashes don't kill dev server
- ✅ **Timeout enforcement** - `child.kill()` terminates runaway handlers
- ✅ **Resource limits** - OS-level process limits apply
- ✅ **Mock injection** - Clean abstraction for vault, checkpoints
- ✅ **Log capture** - stdout/stderr captured for debugging
- ✅ **Clean termination** - Temp files cleaned up after execution

### Production Build Process

**Code Stripper** (`src/builder/stripper.ts`):

```typescript
import * as ts from 'typescript';

/**
 * Strip @TestValue decorators and afh/dev imports from TypeScript source
 * Uses TypeScript Compiler API for accurate AST manipulation
 */
export function stripDevCode(sourcePath: string): StripResult {
  const sourceCode = fs.readFileSync(sourcePath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceCode,
    ts.ScriptTarget.Latest,
    true
  );

  const strippedDecorators: string[] = [];
  const strippedImports: string[] = [];

  // Transformer to remove @TestValue decorators and afh/dev imports
  const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
    return (rootNode) => {
      function visit(node: ts.Node): ts.Node | undefined {
        // Remove imports from './utils' (local TestValue re-export)
        if (ts.isImportDeclaration(node)) {
          const moduleSpecifier = node.moduleSpecifier;
          if (ts.isStringLiteral(moduleSpecifier)) {
            const moduleName = moduleSpecifier.text;
            if (moduleName === './utils' || moduleName.includes('afh/dev')) {
              strippedImports.push(moduleName);
              return undefined; // Remove this import
            }
          }
        }

        // Remove @TestValue decorators from properties
        if (ts.isPropertyDeclaration(node) && node.modifiers) {
          const filteredModifiers = node.modifiers.filter(modifier => {
            if (ts.isDecorator(modifier)) {
              const expression = modifier.expression;
              if (ts.isCallExpression(expression)) {
                const callee = expression.expression;
                if (ts.isIdentifier(callee) && callee.text === 'TestValue') {
                  strippedDecorators.push(node.name.getText());
                  return false; // Remove this decorator
                }
              }
            }
            return true;
          });

          if (filteredModifiers.length !== node.modifiers.length) {
            return ts.factory.updatePropertyDeclaration(
              node,
              filteredModifiers.length > 0 ? filteredModifiers : undefined,
              node.name,
              node.questionToken || node.exclamationToken,
              node.type,
              node.initializer
            );
          }
        }

        return ts.visitEachChild(node, visit, context);
      }

      return ts.visitNode(rootNode, visit) as ts.SourceFile;
    };
  };

  // Apply transformation
  const result = ts.transform(sourceFile, [transformer]);
  const transformedSourceFile = result.transformed[0];

  // Print the transformed code
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const code = printer.printFile(transformedSourceFile);

  result.dispose();

  return { code, strippedDecorators, strippedImports };
}
```

**Build Pipeline:**
1. **Strip dev code** - Remove `@TestValue` decorators via AST manipulation
2. **Bundle** - Single file with all dependencies (esbuild or similar)
3. **Minify** - Terser for production optimization
4. **Security scan** - Detect leaked secrets (API keys, tokens)
5. **Package** - Create `.afh` ZIP archive

**Output Structure** (`.afh` file):
```
handler.afh (ZIP archive)
├── manifest.json          # Handler metadata
├── dist/
│   └── index.js          # Bundled, minified, stripped code
├── docs/
│   └── README.md         # Documentation
├── assets/
│   └── icon.png          # Handler icon (256x256)
└── LICENSE               # MIT license
```

### Handler Manifest Schema

```json
{
  "$schema": "https://agenticflow.com/schemas/handler-manifest-v1.json",
  "id": "my-handler",
  "version": "1.0.0",
  "name": "My Handler",
  "description": "A FlowMonkey handler for processing data",
  "longDescription": "# My Handler\n\nDetailed markdown description...",

  "author": {
    "name": "Developer Name",
    "email": "dev@example.com"
  },

  "handler": {
    "type": "my-handler",
    "category": "integration",
    "stateful": false,
    "timeout": 30000,
    "retryable": true
  },

  "inputs": [
    {
      "property": "apiKey",
      "type": "string",
      "source": "vault",
      "required": true,
      "secret": true,
      "description": "API authentication key",
      "placeholder": "Enter your API key"
    },
    {
      "property": "maxRetries",
      "type": "number",
      "source": "config",
      "required": false,
      "default": 3,
      "min": 0,
      "max": 10,
      "description": "Maximum retry attempts"
    }
  ],

  "outputs": [
    {
      "property": "result",
      "type": "object",
      "description": "Processing result"
    },
    {
      "property": "status",
      "type": "string",
      "description": "Execution status"
    }
  ],

  "visual": {
    "icon": "assets/icon.png",
    "color": "#635BFF",
    "tags": ["integration", "api"]
  },

  "marketplace": {
    "pricing": "free",
    "license": "MIT",
    "repository": "https://github.com/user/my-handler",
    "homepage": "https://docs.example.com/my-handler"
  },

  "requirements": {
    "flowmonkey": ">=0.0.1",
    "node": ">=18.0.0"
  }
}
```

**Manifest Benefits:**
- UI can read metadata without executing code
- Validation before handler registration
- Marketplace integration ready
- Versioning and dependency management

---

## Security Analysis

### Current Attack Surface

**In-Process Execution Risks:**

1. **Full Runtime Access**
   ```typescript
   // Handlers can do ANYTHING
   const fs = require('fs');
   fs.unlinkSync('/etc/passwd'); // Delete system files
   
   process.exit(1); // Crash entire engine
   
   require('child_process').exec('rm -rf /'); // Run shell commands
   ```

2. **Dynamic Code Execution** (`new Function()`)
   ```typescript
   // User expression with full privileges
   const fn = new Function('input', 'context', userExpression);
   fn(data, context); // No validation, no limits
   ```

3. **Resource Exhaustion**
   ```typescript
   // Infinite loop consumes CPU
   while(true) {}
   
   // Memory bomb
   const huge = new Array(1e9).fill('x'.repeat(1e6));
   ```

4. **Network Attacks**
   ```typescript
   // DDoS external services
   for (let i = 0; i < 1000000; i++) {
     fetch('https://victim.com/api');
   }
   ```

5. **Environment Tampering**
   ```typescript
   // Read secrets from env vars
   console.log(process.env.DATABASE_PASSWORD);
   
   // Modify global state
   global.console = { log: () => {} }; // Break logging
   ```

### Threat Modeling

```
┌──────────────────────────────────────────────────────────────┐
│ Threat Scenarios                                             │
├──────────────────────────────────────────────────────────────┤
│ 1. Malicious Handler Author                                  │
│    - Embedded backdoors in handler code                      │
│    - Data exfiltration via network calls                     │
│    - Cryptomining in background                              │
│                                                              │
│ 2. Compromised Handler Package                               │
│    - Supply chain attack via dependencies                    │
│    - Trojan code injected during build                       │
│                                                              │
│ 3. User-Provided Expressions                                 │
│    - Transform/batch handler expressions                     │
│    - Arbitrary code execution via new Function()            │
│    - Prototype pollution attacks                             │
│                                                              │
│ 4. Handler Vulnerabilities                                   │
│    - Unpatched dependencies                                  │
│    - Input validation bypasses                               │
│    - Logic bugs causing crashes                              │
│                                                              │
│ 5. Resource Exhaustion                                       │
│    - Infinite loops                                          │
│    - Memory leaks                                            │
│    - Fork bombs                                              │
└──────────────────────────────────────────────────────────────┘
```

### Risk Assessment

| Risk | Likelihood | Impact | Mitigation Status |
|------|-----------|--------|-------------------|
| Handler crashes engine | High | Critical | ⚠️ Partial (try/catch) |
| Resource exhaustion | High | High | ⚠️ Partial (timeout only) |
| Data exfiltration | Medium | Critical | ❌ None |
| Malicious code execution | Low | Critical | ❌ None |
| Dependency vulnerabilities | Medium | High | ⚠️ Manual review |
| User expression injection | High | Critical | ❌ None |

**Overall Risk Level:** 🔴 **HIGH** - No meaningful isolation for untrusted code

---

## Proposed Improvements

### Option 1: Child Process Isolation (Recommended)

**Architecture:**

```
┌─────────────────────────────────────────────────────────────┐
│ Engine Process (Main)                                        │
│  ├─ Flow orchestration                                      │
│  ├─ State management                                        │
│  ├─ Event emission                                          │
│  └─ Handler process manager                                 │
└─────────────────────────────────────────────────────────────┘
                    ↓ spawn/fork
┌─────────────────────────────────────────────────────────────┐
│ Handler Process (Child)                                     │
│  ├─ Handler execution                                       │
│  ├─ Resource limits (OS-level)                              │
│  ├─ Timeout enforcement                                     │
│  └─ Crash isolation                                         │
└─────────────────────────────────────────────────────────────┘
```

**Implementation:**

```typescript
// packages/core/src/engine/handler-executor.ts

export interface HandlerExecutorOptions {
  timeout: number;          // Handler timeout in ms
  memoryLimit?: number;     // Max memory in MB
  cpuLimit?: number;        // Max CPU percentage
  maxProcesses?: number;    // Concurrent handler processes
}

export class HandlerExecutor {
  private activeProcesses = new Map<string, ChildProcess>();
  
  async execute(
    handler: StepHandler,
    params: HandlerParams
  ): Promise<StepResult> {
    const processId = crypto.randomUUID();
    
    // Generate execution script
    const script = this.generateExecutionScript(handler, params);
    const scriptPath = path.join(os.tmpdir(), `handler-${processId}.js`);
    fs.writeFileSync(scriptPath, script);
    
    return new Promise((resolve, reject) => {
      const child = spawn('node', [
        '--max-old-space-size=' + (this.options.memoryLimit || 512),
        scriptPath
      ], {
        env: {
          HANDLER_EXECUTION_ID: params.execution.id,
          HANDLER_STEP_ID: params.step.id,
        },
        timeout: this.options.timeout,
        killSignal: 'SIGTERM'
      });
      
      this.activeProcesses.set(processId, child);
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      child.on('exit', (code, signal) => {
        this.activeProcesses.delete(processId);
        fs.unlinkSync(scriptPath);
        
        if (signal === 'SIGTERM') {
          resolve({
            outcome: 'failure',
            error: { code: 'TIMEOUT', message: 'Handler execution timed out' }
          });
          return;
        }
        
        // Parse result from stdout
        const resultMatch = stdout.match(/__FLOWMONKEY_RESULT__:(.+)$/m);
        if (resultMatch) {
          const result = JSON.parse(resultMatch[1]);
          resolve(result);
        } else {
          reject(new Error('Failed to parse handler result'));
        }
      });
    });
  }
  
  private generateExecutionScript(
    handler: StepHandler,
    params: HandlerParams
  ): string {
    return `
const handler = require('${handler.modulePath}');

// Serialize params
const params = ${JSON.stringify({
  input: params.input,
  context: params.context,
  stepId: params.step.id,
  executionId: params.execution.id,
})};

async function run() {
  try {
    const result = await handler.execute(params);
    console.log('__FLOWMONKEY_RESULT__:' + JSON.stringify(result));
    process.exit(0);
  } catch (error) {
    console.log('__FLOWMONKEY_RESULT__:' + JSON.stringify({
      outcome: 'failure',
      error: {
        code: 'HANDLER_ERROR',
        message: error.message,
        stack: error.stack
      }
    }));
    process.exit(1);
  }
}

run();
`;
  }
}
```

**Benefits:**
- ✅ Process isolation - Handler crashes don't affect engine
- ✅ Resource limits - OS-level memory/CPU limits
- ✅ Timeout enforcement - Kill runaway processes
- ✅ Clean termination - Process cleanup on completion
- ✅ Log isolation - Captured stdout/stderr

**Tradeoffs:**
- ⚠️ Performance overhead - Process spawning (~50-100ms)
- ⚠️ Serialization cost - JSON encoding of params/results
- ⚠️ State management - Context must be serialized
- ⚠️ Debugging complexity - Multi-process debugging

### Option 2: Worker Threads

**Architecture:**

```typescript
import { Worker } from 'worker_threads';

export class HandlerWorker {
  async execute(handler: StepHandler, params: HandlerParams): Promise<StepResult> {
    const worker = new Worker('./handler-worker.js', {
      workerData: {
        handlerPath: handler.modulePath,
        params: params,
      },
      resourceLimits: {
        maxOldGenerationSizeMb: 512,
        maxYoungGenerationSizeMb: 128,
      }
    });
    
    return new Promise((resolve, reject) => {
      worker.on('message', (result) => {
        resolve(result);
        worker.terminate();
      });
      
      worker.on('error', reject);
      
      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
      
      // Timeout
      setTimeout(() => {
        worker.terminate();
        reject(new Error('Handler execution timed out'));
      }, this.options.timeout);
    });
  }
}
```

**Benefits:**
- ✅ Faster than child processes (~10ms startup)
- ✅ Shared memory possible for large data
- ✅ Resource limits supported
- ⚠️ Limited isolation (same process, different thread)

**Tradeoffs:**
- ⚠️ Less isolation than child processes
- ⚠️ Shared memory can leak between threads
- ⚠️ Can still crash main process (segfaults)
- ⚠️ Module loading complexities

### Option 3: VM Sandboxing

**Architecture:**

```typescript
import { VM } from 'vm2';

export class HandlerVM {
  async execute(handler: StepHandler, params: HandlerParams): Promise<StepResult> {
    const vm = new VM({
      timeout: this.options.timeout,
      sandbox: {
        console: console,
        // Whitelist only safe globals
      },
      require: {
        external: false, // Disable require() by default
        builtin: [], // No built-in modules
      }
    });
    
    const code = `
      const handler = ${handler.code};
      const params = ${JSON.stringify(params)};
      handler.execute(params);
    `;
    
    return vm.run(code);
  }
}
```

**Benefits:**
- ✅ Code-level sandboxing
- ✅ No process overhead
- ✅ Fine-grained permission control

**Tradeoffs:**
- ⚠️ VM escapes possible (security vulnerabilities)
- ⚠️ Complex to configure correctly
- ⚠️ Performance overhead for context switches
- ⚠️ Limited Node.js API access

### Option 4: Container Isolation

**Architecture:**

```bash
# Handler execution in Docker container
docker run \
  --rm \
  --read-only \
  --memory=512m \
  --cpus=0.5 \
  --network=none \
  --cap-drop=ALL \
  flowmonkey/handler-runner:latest \
  node /app/handler.js
```

**Benefits:**
- ✅ Maximum isolation (kernel-level)
- ✅ Resource limits enforced by cgroups
- ✅ Filesystem isolation
- ✅ Network isolation possible

**Tradeoffs:**
- ⚠️ High overhead (~500ms-2s startup)
- ⚠️ Docker/K8s dependency
- ⚠️ Complex orchestration
- ⚠️ Not suitable for fast handlers

### Option 5: WebAssembly Sandboxing

**Architecture:**

```typescript
import { WASI } from 'wasi';

export class HandlerWasm {
  async execute(wasmModule: WebAssembly.Module, params: HandlerParams): Promise<StepResult> {
    const wasi = new WASI({
      args: ['handler'],
      env: {},
      preopens: {}, // No filesystem access
    });
    
    const instance = await WebAssembly.instantiate(wasmModule, {
      wasi_snapshot_preview1: wasi.wasiImport,
    });
    
    wasi.start(instance);
    
    // Call exported handler function
    return instance.exports.execute(params);
  }
}
```

**Benefits:**
- ✅ Memory-safe execution
- ✅ No access to Node.js APIs
- ✅ Fast startup (~1-5ms)
- ✅ Portable across platforms

**Tradeoffs:**
- ⚠️ Handlers must be compiled to WASM
- ⚠️ Limited ecosystem (no npm modules)
- ⚠️ Complex interop with JavaScript
- ⚠️ Debugging difficulties

### Recommendation Matrix

| Use Case | Recommended Approach | Rationale |
|----------|---------------------|-----------|
| **Trusted handlers** | In-process (current) | Performance, simplicity |
| **User expressions** | Child process + validation | Balance of security & perf |
| **Marketplace handlers** | Child process | Isolation, resource limits |
| **Long-running stateful** | Container | Maximum isolation |
| **High-frequency calls** | Worker threads | Low overhead |
| **Untrusted code** | Container or WASM | Maximum security |

---

## Implementation Roadmap

### Phase 1: Foundation (Weeks 1-2)

**Goals:**
- Add handler execution interface abstraction
- Implement child process executor
- Update engine to use pluggable executor

**Tasks:**
1. Create `HandlerExecutor` interface
   ```typescript
   interface HandlerExecutor {
     execute(handler: StepHandler, params: HandlerParams): Promise<StepResult>;
   }
   ```

2. Implement `InProcessExecutor` (current behavior)
   ```typescript
   class InProcessExecutor implements HandlerExecutor {
     async execute(handler, params) {
       return handler.execute(params);
     }
   }
   ```

3. Implement `ChildProcessExecutor`
   ```typescript
   class ChildProcessExecutor implements HandlerExecutor {
     async execute(handler, params) {
       // Spawn child process as shown in Option 1
     }
   }
   ```

4. Update `Engine` to accept executor
   ```typescript
   class Engine {
     constructor(
       store: StateStore,
       handlers: HandlerRegistry,
       flows: FlowRegistry,
       eventBus?: EventBus,
       executor?: HandlerExecutor // New parameter
     ) {
       this.executor = executor || new InProcessExecutor();
     }
   }
   ```

**Deliverables:**
- ✅ Pluggable executor architecture
- ✅ Backwards compatibility (default in-process)
- ✅ Child process executor implementation
- ✅ Unit tests for both executors

### Phase 2: Handler Manifest (Weeks 3-4)

**Goals:**
- Define handler manifest schema
- Add manifest validation
- Support manifest-based handler registration

**Tasks:**
1. Create manifest JSON schema
2. Add `HandlerManifest` type to `@flowmonkey/core`
3. Update `HandlerRegistry` to accept manifests
4. Add manifest validation in registration

**Deliverables:**
- ✅ Handler manifest specification
- ✅ JSON schema for validation
- ✅ Registry supports manifest-based handlers
- ✅ Documentation and examples

### Phase 3: Dev/Prod Split (Weeks 5-6)

**Goals:**
- Add `@TestValue` decorator support
- Implement build-time code stripping
- Create handler development toolkit

**Tasks:**
1. Create `@flowmonkey/dev` package with `@TestValue`
2. Implement AST-based code stripper
3. Add build command to strip dev code
4. Create handler project template

**Deliverables:**
- ✅ `@TestValue` decorator for dev
- ✅ Build tool strips dev code
- ✅ Handler template with best practices
- ✅ Documentation for handler developers

### Phase 4: Security Enhancements (Weeks 7-8)

**Goals:**
- Add resource limits to child process executor
- Implement expression validation
- Add security scanning for handlers

**Tasks:**
1. Add memory/CPU limits to child processes
2. Create expression validator for transform/batch handlers
3. Implement secret scanning in build pipeline
4. Add handler signature verification

**Deliverables:**
- ✅ Resource-limited child processes
- ✅ Expression validation (allowlist/denylist)
- ✅ Security scanning tools
- ✅ Handler verification system

### Phase 5: Performance Optimization (Weeks 9-10)

**Goals:**
- Optimize child process execution
- Add process pooling
- Implement warm-start optimization

**Tasks:**
1. Create process pool manager
2. Implement handler preloading
3. Add result caching for idempotent handlers
4. Benchmark and optimize serialization

**Deliverables:**
- ✅ Process pool for reuse
- ✅ Warm handlers (faster startup)
- ✅ Optimized serialization
- ✅ Performance benchmarks

### Phase 6: Developer Experience (Weeks 11-12)

**Goals:**
- Create handler CLI (`afh` equivalent)
- Build visual handler development UI
- Add marketplace integration

**Tasks:**
1. Implement `flowmonkey-cli` with `init`, `dev`, `build`, `test` commands
2. Create React-based dev UI with handler testing
3. Add hot-reload for handler development
4. Implement handler packaging and publishing

**Deliverables:**
- ✅ Handler CLI tool
- ✅ Visual dev environment
- ✅ Handler marketplace infrastructure
- ✅ Complete developer documentation

---

## Technical Specifications

### Handler Execution Protocol

**Request Format:**
```json
{
  "handler": {
    "type": "http-request",
    "modulePath": "/path/to/handler.js"
  },
  "params": {
    "input": { "url": "https://api.example.com" },
    "context": { "userId": "123" },
    "step": { "id": "step1", "type": "http-request" },
    "execution": { "id": "exec-1", "flowId": "flow-1" }
  },
  "options": {
    "timeout": 30000,
    "memoryLimit": 512,
    "cpuLimit": 50
  }
}
```

**Response Format:**
```json
{
  "outcome": "success",
  "output": { "status": 200, "body": "..." },
  "duration": 1234,
  "logs": ["Handler started", "Request sent", "Response received"]
}
```

**Error Format:**
```json
{
  "outcome": "failure",
  "error": {
    "code": "HANDLER_ERROR",
    "message": "Connection timeout",
    "stack": "Error: Connection timeout\n  at ...",
    "details": { "url": "https://api.example.com" }
  },
  "duration": 30000,
  "logs": ["Handler started", "Request sent", "Timeout occurred"]
}
```

### Handler Manifest Schema v1.0

```json
{
  "$schema": "https://flowmonkey.dev/schemas/handler-manifest-v1.json",
  "manifestVersion": "1.0",
  "handler": {
    "id": "unique-handler-id",
    "version": "1.0.0",
    "name": "Handler Name",
    "description": "Short description",
    "longDescription": "Markdown formatted long description",
    "type": "handler-type",
    "category": "integration|data|control|ai|utility",
    "stateful": false,
    "timeout": 30000,
    "retryable": true,
    "tags": ["tag1", "tag2"]
  },
  "author": {
    "name": "Author Name",
    "email": "author@example.com",
    "url": "https://example.com"
  },
  "inputs": [
    {
      "property": "inputName",
      "type": "string|number|boolean|object|array",
      "source": "config|vault|previous|context",
      "required": true,
      "secret": false,
      "default": null,
      "description": "Input description",
      "placeholder": "Placeholder text",
      "validation": {
        "pattern": "regex pattern",
        "min": 0,
        "max": 100,
        "enum": ["option1", "option2"]
      }
    }
  ],
  "outputs": [
    {
      "property": "outputName",
      "type": "string|number|boolean|object|array",
      "description": "Output description"
    }
  ],
  "visual": {
    "icon": "assets/icon.png",
    "color": "#635BFF",
    "preview": "assets/preview.png"
  },
  "marketplace": {
    "pricing": "free|paid|enterprise",
    "license": "MIT|Apache-2.0|Proprietary",
    "repository": "https://github.com/user/repo",
    "homepage": "https://example.com",
    "documentation": "https://docs.example.com",
    "support": "https://support.example.com"
  },
  "requirements": {
    "flowmonkey": ">=1.0.0",
    "node": ">=18.0.0",
    "dependencies": {
      "axios": "^1.0.0"
    }
  },
  "security": {
    "permissions": ["network", "filesystem:read"],
    "trusted": false,
    "verified": false,
    "signature": "digital signature"
  }
}
```

### Process Communication Protocol

**IPC Channel:**
```typescript
// Parent → Child
process.send({
  type: 'execute',
  id: 'exec-1',
  handler: { ... },
  params: { ... }
});

// Child → Parent
process.send({
  type: 'result',
  id: 'exec-1',
  result: { ... }
});

process.send({
  type: 'log',
  id: 'exec-1',
  level: 'info',
  message: 'Handler started'
});

process.send({
  type: 'progress',
  id: 'exec-1',
  percent: 50,
  message: 'Processing...'
});
```

---

## Appendix

### A. Known Issues from AFH CLI

From `TECHNICAL_DEBT.md`:

1. **`.npmignore` Pattern Matching** (Resolved)
   - Issue: `src/` pattern matched nested `src/` directories
   - Fix: Use `/src/` with leading slash for root-only matching

2. **Pre-built UI Bundle** (Resolved)
   - Issue: ESM/CJS conflicts with React dependencies
   - Fix: Pre-build UI with Vite, ship compiled bundle

3. **Express 5 Wildcard Syntax** (Resolved)
   - Issue: `*` wildcard no longer valid in Express 5
   - Fix: Use `/{*splat}` named splat syntax

4. **API Proxy Configuration**
   - Issue: UI calls `/api/*` on wrong port
   - Fix: Express middleware proxies to API server

### B. Performance Benchmarks

**Child Process Overhead:**
- Process spawn: ~50-100ms
- JSON serialization: ~1-5ms per MB
- IPC communication: ~0.1-1ms per message
- Total overhead: ~100-150ms per handler execution

**Comparison:**
| Approach | Startup | Overhead | Isolation | Best For |
|----------|---------|----------|-----------|----------|
| In-process | 0ms | 0ms | None | Trusted handlers |
| Worker threads | ~10ms | ~5ms | Limited | Fast handlers |
| Child process | ~100ms | ~10ms | Good | User handlers |
| Containers | ~2000ms | ~100ms | Excellent | Long-running |
| WASM | ~5ms | ~2ms | Excellent | Compute-heavy |

### C. Security Checklist

**Handler Development:**
- [ ] Input validation on all user-provided data
- [ ] No `eval()` or `new Function()` with user input
- [ ] Secrets from vault, not hardcoded
- [ ] Error messages don't leak sensitive data
- [ ] Dependencies are up-to-date and audited
- [ ] Resource usage is bounded (no infinite loops)

**Handler Registration:**
- [ ] Handler manifest is valid
- [ ] Handler signature is verified (if using marketplace)
- [ ] Permissions are appropriate for handler type
- [ ] Source code is reviewed (for custom handlers)
- [ ] Dependencies are scanned for vulnerabilities

**Runtime:**
- [ ] Handlers execute in isolated environment
- [ ] Resource limits are enforced
- [ ] Timeouts are configured appropriately
- [ ] Logs don't contain sensitive data
- [ ] Network access is restricted as needed

### D. References

**FlowMonkey Core:**
- `packages/core/src/engine/execution-engine.ts` - Main execution engine
- `packages/core/src/types/flow.ts` - Flow and step types
- `packages/core/src/interfaces/step-handler.ts` - Handler interface
- `packages/handlers/src/class/transform.ts` - Transform handler (`new Function()`)
- `packages/handlers/src/class/batch-process.ts` - Batch handler (`new Function()`)

**AFH CLI Tool:**
- `handler_dev/src/cli/dev.ts` - Dev server command
- `handler_dev/src/dev/server.ts` - API server with WebSocket
- `handler_dev/src/dev/executor.ts` - Child process executor
- `handler_dev/src/builder/stripper.ts` - AST-based code stripping
- `handler_dev/TECHNICAL_DEBT.md` - Known issues and fixes

**Handler Example:**
- `paypall-invoice-generator/manifest.json` - Handler manifest
- `paypall-invoice-generator/src/index.ts` - Handler implementation
- `paypall-invoice-generator/src/utils.ts` - `@TestValue` decorator

---

## Conclusion

FlowMonkey's current in-process handler execution model provides excellent performance but poses significant security risks for untrusted code. The AFH CLI demonstrates a proven pattern for child process isolation that balances security, performance, and developer experience.

**Key Recommendations:**

1. **Implement pluggable handler executor architecture** to support multiple execution strategies
2. **Adopt child process isolation** for handlers from marketplace or user-provided code
3. **Create handler manifest specification** for metadata-driven handler management
4. **Support dev/prod code splitting** with `@TestValue` pattern
5. **Build comprehensive handler development toolkit** with CLI, UI, and templates

This approach provides a migration path from the current unsafe model to a production-ready, secure architecture while maintaining backwards compatibility for trusted handlers.

---

**Next Steps:**
- Review and approve architectural decisions
- Prioritize implementation phases
- Assign development resources
- Begin Phase 1 implementation

**Document Status:** Draft for Review  
**Last Updated:** February 3, 2026  
**Authors:** FlowMonkey Security Team
