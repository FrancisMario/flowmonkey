import { vi } from 'vitest';
import type { FlowRegistry, Engine } from '@flowmonkey/core';

// Mock FlowRegistry
export const mockFlowRegistry = {
  get: vi.fn(),
  has: vi.fn(),
  register: vi.fn(),
  flowIds: vi.fn(),
  versions: vi.fn(),
  validate: vi.fn(),
} as unknown as FlowRegistry & { get: ReturnType<typeof vi.fn> };

// Mock Engine
export const mockEngine = {
  create: vi.fn(),
  tick: vi.fn(),
  run: vi.fn(),
  cancel: vi.fn(),
  get: vi.fn(),
  flows: mockFlowRegistry,
} as unknown as Engine & { create: ReturnType<typeof vi.fn> };

// Mock flow
export const mockFlow = {
  id: 'test-flow',
  version: '1.0.0',
  initialStepId: 'start',
  steps: {},
};

export function resetMocks() {
  vi.clearAllMocks();
  mockFlowRegistry.get.mockReturnValue(mockFlow);
  mockEngine.create.mockResolvedValue({
    execution: { id: 'exec_abc123' },
    created: true,
    idempotencyHit: false,
  });
}
