/**
 * Test Flows
 *
 * Predefined flow definitions for testing the execution engine.
 * Each flow demonstrates a specific execution pattern.
 *
 * Flows:
 * - simpleFlow: Basic 2-step execution (echo → transform)
 * - branchFlow: Conditional routing with 4 paths
 * - waitFlow: Wait/resume pattern (start → wait → finish)
 * - errorFlow: Error handling with onFailure transition
 * - infiniteFlow: Infinite loop for max steps testing
 * - longWaitFlow: Extended wait for cancellation testing
 *
 * @see README.md for full documentation
 */
import type { Flow } from '../types/flow';

/**
 * Simple flow: echo input, then transform to uppercase.
 * Tests basic sequential execution and output storage.
 */
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

/**
 * Infinite loop flow for testing max steps.
 */
export const infiniteFlow: Flow = {
  id: 'infinite',
  version: '1.0.0',
  initialStepId: 'step1',
  steps: {
    step1: {
      id: 'step1',
      type: 'echo',
      config: {},
      input: { type: 'static', value: 'loop' },
      outputKey: 'val',
      transitions: { onSuccess: 'step2' },
    },
    step2: {
      id: 'step2',
      type: 'echo',
      config: {},
      input: { type: 'key', key: 'val' },
      outputKey: 'val2',
      transitions: { onSuccess: 'step1' }, // Loop back
    },
  },
};

/**
 * Long wait flow for testing cancellation.
 */
export const longWaitFlow: Flow = {
  id: 'long-wait',
  version: '1.0.0',
  initialStepId: 'start',
  steps: {
    start: {
      id: 'start',
      type: 'set',
      config: { value: 'started' },
      input: { type: 'static', value: null },
      outputKey: 'status',
      transitions: { onSuccess: 'wait' },
    },
    wait: {
      id: 'wait',
      type: 'delay',
      config: { ms: 60000 },
      input: { type: 'static', value: null },
      transitions: { onSuccess: 'done' },
    },
    done: {
      id: 'done',
      type: 'set',
      config: { value: 'done' },
      input: { type: 'static', value: null },
      outputKey: 'status',
      transitions: { onSuccess: null },
    },
  },
};
