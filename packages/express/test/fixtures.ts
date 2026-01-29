/**
 * Test fixtures and mocks for @flowmonkey/express tests.
 */

import { vi } from 'vitest';
import type { StateStore, FlowRegistry, HandlerRegistry, Execution, Flow } from '@flowmonkey/core';

/**
 * Create a mock StateStore for testing.
 */
export function createMockStateStore(): StateStore & { _executions: Map<string, Execution> } {
  const executions = new Map<string, Execution>();

  return {
    _executions: executions,
    load: vi.fn(async (id: string) => executions.get(id) ?? null),
    save: vi.fn(async (execution: Execution) => {
      executions.set(execution.id, execution);
    }),
    delete: vi.fn(async (id: string) => executions.delete(id)),
    listWakeReady: vi.fn(async () => []),
    listByStatus: vi.fn(async () => []),
  };
}

/**
 * Create a mock FlowRegistry for testing.
 */
export function createMockFlowRegistry(): FlowRegistry & { _flows: Map<string, Flow> } {
  const flows = new Map<string, Flow>();

  // Add a test flow
  const testFlow: Flow = {
    id: 'test-flow',
    version: '1.0.0',
    name: 'Test Flow',
    initialStepId: 'step1',
    steps: {
      step1: {
        id: 'step1',
        type: 'transform',
        config: {},
        input: { type: 'full' },
        transitions: { onSuccess: null },
      },
    },
  };
  flows.set('test-flow', testFlow);

  return {
    _flows: flows,
    register: vi.fn((flow: Flow) => {
      flows.set(flow.id, flow);
    }),
    get: vi.fn((id: string) => flows.get(id)),
    has: vi.fn((id: string) => flows.has(id)),
    flowIds: vi.fn(() => Array.from(flows.keys())),
    versions: vi.fn(() => ['1.0.0']),
    validate: vi.fn(() => []),
  };
}

/**
 * Create a mock HandlerRegistry for testing.
 */
export function createMockHandlerRegistry(): HandlerRegistry {
  const handlers = new Map<string, { metadata: { name: string; type: string; description?: string; category?: string; stateful?: boolean; configSchema: Record<string, unknown> } }>();
  handlers.set('transform', {
    metadata: {
      type: 'transform',
      name: 'Transform',
      description: 'Transform data',
      category: 'data',
      stateful: false,
      configSchema: { type: 'object' },
    },
  });
  handlers.set('http', {
    metadata: {
      type: 'http',
      name: 'HTTP',
      description: 'Make HTTP requests',
      category: 'external',
      stateful: false,
      configSchema: { type: 'object' },
    },
  });

  return {
    register: vi.fn(),
    registerAll: vi.fn(),
    get: vi.fn((type: string) => handlers.get(type) as never),
    getConstructor: vi.fn(),
    isClassBased: vi.fn(() => false),
    has: vi.fn((type: string) => handlers.has(type)),
    types: vi.fn(() => Array.from(handlers.keys())),
    unregister: vi.fn(() => true),
    getMetadata: vi.fn((type: string) => handlers.get(type)?.metadata as ReturnType<HandlerRegistry['getMetadata']>),
    getAllMetadata: vi.fn(() => Array.from(handlers.values()).map((h) => h.metadata) as ReturnType<HandlerRegistry['getAllMetadata']>),
    listByCategory: vi.fn(() => []),
    getStateful: vi.fn(() => []),
    getStateless: vi.fn(() => Array.from(handlers.values()).map((h) => h.metadata) as ReturnType<HandlerRegistry['getStateless']>),
    exportManifest: vi.fn(() => ({ version: '1.0.0', handlers: [], categories: {} })),
    search: vi.fn(() => []),
  };
}

/**
 * Create a test execution.
 */
export function createTestExecution(overrides: Partial<Execution> = {}): Execution {
  const now = Date.now();
  return {
    id: `exec_${now}_${Math.random().toString(36).slice(2, 9)}`,
    flowId: 'test-flow',
    flowVersion: '1.0.0',
    currentStepId: 'step1',
    status: 'pending',
    context: {},
    stepCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
