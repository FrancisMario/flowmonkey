/**
 * Flow Registry Tests
 *
 * Tests for DefaultFlowRegistry covering:
 * - Flow registration with validation
 * - Invalid flow rejection (missing steps, bad transitions)
 * - Multi-version support per flow ID
 * - Latest vs specific version retrieval
 * - Existence checks
 *
 * @see README.md for full test documentation
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DefaultFlowRegistry } from '../impl/flow-registry';
import { FlowValidationError } from '../types/errors';
import type { Flow } from '../types/flow';

function createFlow(id: string, version = '1.0.0', overrides: Partial<Flow> = {}): Flow {
  return {
    id,
    version,
    initialStepId: 'step1',
    steps: {
      step1: {
        id: 'step1',
        type: 'echo',
        config: {},
        input: { type: 'static', value: 'test' },
        transitions: { onSuccess: null },
      },
    },
    ...overrides,
  };
}

describe('DefaultFlowRegistry', () => {
  let registry: DefaultFlowRegistry;

  beforeEach(() => {
    registry = new DefaultFlowRegistry();
  });

  describe('registration', () => {
    it('registers a valid flow', () => {
      const flow = createFlow('test-flow');
      registry.register(flow);

      expect(registry.has('test-flow')).toBe(true);
      expect(registry.get('test-flow')).toEqual(flow);
    });

    it('throws on invalid flow', () => {
      const invalidFlow: Flow = {
        id: 'invalid',
        version: '1.0.0',
        initialStepId: 'missing',
        steps: {},
      };

      expect(() => registry.register(invalidFlow)).toThrow(FlowValidationError);
    });

    it('throws when initialStepId not found', () => {
      const flow: Flow = {
        id: 'bad-initial',
        version: '1.0.0',
        initialStepId: 'not-exists',
        steps: {
          step1: {
            id: 'step1',
            type: 'echo',
            config: {},
            input: { type: 'static', value: null },
            transitions: {},
          },
        },
      };

      expect(() => registry.register(flow)).toThrow('not-exists');
    });

    it('throws when transition target not found', () => {
      const flow: Flow = {
        id: 'bad-transition',
        version: '1.0.0',
        initialStepId: 'step1',
        steps: {
          step1: {
            id: 'step1',
            type: 'echo',
            config: {},
            input: { type: 'static', value: null },
            transitions: { onSuccess: 'not-exists' },
          },
        },
      };

      expect(() => registry.register(flow)).toThrow('not-exists');
    });
  });

  describe('versioning', () => {
    it('registers multiple versions of same flow', () => {
      const v1 = createFlow('my-flow', '1.0.0');
      const v2 = createFlow('my-flow', '2.0.0');

      registry.register(v1);
      registry.register(v2);

      expect(registry.get('my-flow', '1.0.0')).toEqual(v1);
      expect(registry.get('my-flow', '2.0.0')).toEqual(v2);
    });

    it('get without version returns latest registered', () => {
      registry.register(createFlow('my-flow', '1.0.0'));
      registry.register(createFlow('my-flow', '2.0.0'));

      // Without version should return the last registered
      const flow = registry.get('my-flow');
      expect(flow?.version).toBe('2.0.0');
    });

    it('get with version returns specific version', () => {
      registry.register(createFlow('my-flow', '1.0.0'));
      registry.register(createFlow('my-flow', '2.0.0'));

      const v1 = registry.get('my-flow', '1.0.0');
      expect(v1?.version).toBe('1.0.0');
    });

    it('returns undefined for non-existent version', () => {
      registry.register(createFlow('my-flow', '1.0.0'));

      const result = registry.get('my-flow', '3.0.0');
      expect(result).toBeUndefined();
    });
  });

  describe('has()', () => {
    it('returns true for registered flow', () => {
      registry.register(createFlow('exists'));
      expect(registry.has('exists')).toBe(true);
    });

    it('returns false for unregistered flow', () => {
      expect(registry.has('not-exists')).toBe(false);
    });
  });

  describe('get()', () => {
    it('returns undefined for unregistered flow', () => {
      expect(registry.get('not-exists')).toBeUndefined();
    });
  });

  describe('validation', () => {
    it('validates flow with all transition types', () => {
      const flow: Flow = {
        id: 'full-transitions',
        version: '1.0.0',
        initialStepId: 'step1',
        steps: {
          step1: {
            id: 'step1',
            type: 'try',
            config: {},
            input: { type: 'full' },
            transitions: { 
              onSuccess: 'step2',
              onFailure: 'error-handler',
              onResume: 'resume-handler',
            },
          },
          step2: {
            id: 'step2',
            type: 'echo',
            config: {},
            input: { type: 'static', value: null },
            transitions: { onSuccess: null },
          },
          'error-handler': {
            id: 'error-handler',
            type: 'log',
            config: {},
            input: { type: 'static', value: null },
            transitions: { onSuccess: null },
          },
          'resume-handler': {
            id: 'resume-handler',
            type: 'continue',
            config: {},
            input: { type: 'static', value: null },
            transitions: { onSuccess: 'step2' },
          },
        },
      };

      // Should not throw
      registry.register(flow);
      expect(registry.has('full-transitions')).toBe(true);
    });

    it('validates step id matches key', () => {
      const flow: Flow = {
        id: 'mismatched-id',
        version: '1.0.0',
        initialStepId: 'step1',
        steps: {
          step1: {
            id: 'different-id', // Mismatched!
            type: 'echo',
            config: {},
            input: { type: 'static', value: null },
            transitions: {},
          },
        },
      };

      expect(() => registry.register(flow)).toThrow();
    });
  });
});
