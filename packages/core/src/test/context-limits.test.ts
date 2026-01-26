/**
 * Context Limits Tests
 *
 * Tests for context validation and size limiting:
 * - Value size calculation for primitives and objects
 * - Nesting depth calculation for nested structures
 * - ContextHelpersImpl enforcement of limits:
 *   - maxValueSize: Individual value size limit
 *   - maxTotalSize: Total context size limit
 *   - maxKeys: Maximum number of context keys
 *   - maxDepth: Maximum nesting depth
 *
 * @see README.md for full test documentation
 */
import { describe, it, expect } from 'vitest';
import {
  ContextHelpersImpl,
  calculateValueSize,
  calculateNestingDepth,
  DEFAULT_CONTEXT_LIMITS,
} from '../engine/context-helpers';
import {
  ContextValueTooLargeError,
  ContextSizeLimitError,
  ContextKeyLimitError,
  ContextNestingError,
} from '../types/errors';

describe('Context Limits', () => {
  describe('calculateValueSize', () => {
    it('calculates size of primitives', () => {
      expect(calculateValueSize('hello')).toBe(7); // "hello" = 7 bytes
      expect(calculateValueSize(123)).toBe(3);
      expect(calculateValueSize(true)).toBe(4);
      expect(calculateValueSize(null)).toBe(4);
      expect(calculateValueSize(undefined)).toBe(0);
    });

    it('calculates size of objects', () => {
      const obj = { name: 'test', value: 123 };
      const size = calculateValueSize(obj);
      expect(size).toBe(Buffer.byteLength(JSON.stringify(obj), 'utf8'));
    });

    it('calculates size of arrays', () => {
      const arr = [1, 2, 3, 4, 5];
      const size = calculateValueSize(arr);
      expect(size).toBe(Buffer.byteLength(JSON.stringify(arr), 'utf8'));
    });
  });

  describe('calculateNestingDepth', () => {
    it('returns 0 for primitives', () => {
      expect(calculateNestingDepth('hello')).toBe(0);
      expect(calculateNestingDepth(123)).toBe(0);
      expect(calculateNestingDepth(null)).toBe(0);
    });

    it('returns 1 for flat objects', () => {
      expect(calculateNestingDepth({})).toBe(1);
      expect(calculateNestingDepth({ a: 1, b: 2 })).toBe(1);
    });

    it('returns correct depth for nested objects', () => {
      expect(calculateNestingDepth({ a: { b: 1 } })).toBe(2);
      expect(calculateNestingDepth({ a: { b: { c: 1 } } })).toBe(3);
    });

    it('returns correct depth for arrays', () => {
      expect(calculateNestingDepth([])).toBe(1);
      expect(calculateNestingDepth([1, 2, 3])).toBe(1);
      expect(calculateNestingDepth([[1], [2]])).toBe(2);
    });

    it('handles mixed structures', () => {
      expect(calculateNestingDepth({ arr: [{ nested: 1 }] })).toBe(3);
    });
  });

  describe('ContextHelpersImpl', () => {
    it('allows values within limits', async () => {
      const context: Record<string, unknown> = {};
      const helpers = new ContextHelpersImpl('exec-1', context);
      
      await helpers.set('small', 'hello world');
      expect(context.small).toBe('hello world');
    });

    it('rejects values exceeding maxValueSize', async () => {
      const context: Record<string, unknown> = {};
      const helpers = new ContextHelpersImpl('exec-1', context, undefined, undefined, {
        maxValueSize: 100, // 100 bytes max
      });
      
      const largeValue = 'x'.repeat(200);
      await expect(helpers.set('large', largeValue)).rejects.toThrow(ContextValueTooLargeError);
    });

    it('rejects values exceeding maxDepth', async () => {
      const context: Record<string, unknown> = {};
      const helpers = new ContextHelpersImpl('exec-1', context, undefined, undefined, {
        maxDepth: 3,
      });
      
      const deepValue = { a: { b: { c: { d: 1 } } } }; // depth 4
      await expect(helpers.set('deep', deepValue)).rejects.toThrow(ContextNestingError);
    });

    it('rejects when key count exceeds maxKeys', async () => {
      const context: Record<string, unknown> = {};
      const helpers = new ContextHelpersImpl('exec-1', context, undefined, undefined, {
        maxKeys: 3,
      });
      
      await helpers.set('key1', 'value1');
      await helpers.set('key2', 'value2');
      await helpers.set('key3', 'value3');
      
      await expect(helpers.set('key4', 'value4')).rejects.toThrow(ContextKeyLimitError);
    });

    it('allows updating existing key without counting as new', async () => {
      const context: Record<string, unknown> = {};
      const helpers = new ContextHelpersImpl('exec-1', context, undefined, undefined, {
        maxKeys: 2,
      });
      
      await helpers.set('key1', 'value1');
      await helpers.set('key2', 'value2');
      // Should work because we're updating, not adding
      await helpers.set('key1', 'updated');
      expect(context.key1).toBe('updated');
    });

    it('rejects when total size exceeds maxTotalSize', async () => {
      const context: Record<string, unknown> = {};
      const helpers = new ContextHelpersImpl('exec-1', context, undefined, undefined, {
        maxTotalSize: 100,
        maxValueSize: 200, // Allow larger individual values
      });
      
      await helpers.set('key1', 'x'.repeat(40));
      await expect(helpers.set('key2', 'y'.repeat(80))).rejects.toThrow(ContextSizeLimitError);
    });

    it('tracks size correctly on delete', async () => {
      const context: Record<string, unknown> = {};
      const helpers = new ContextHelpersImpl('exec-1', context, undefined, undefined, {
        maxTotalSize: 100,
        maxValueSize: 60,
      });
      
      await helpers.set('key1', 'x'.repeat(40));
      await helpers.delete('key1');
      // Should now have room
      await helpers.set('key2', 'y'.repeat(50));
      expect(context.key2).toBeDefined();
    });

    it('uses default limits', () => {
      const context: Record<string, unknown> = {};
      const helpers = new ContextHelpersImpl('exec-1', context);
      const limits = helpers.getLimits();
      
      expect(limits.maxValueSize).toBe(DEFAULT_CONTEXT_LIMITS.maxValueSize);
      expect(limits.maxTotalSize).toBe(DEFAULT_CONTEXT_LIMITS.maxTotalSize);
      expect(limits.maxKeys).toBe(DEFAULT_CONTEXT_LIMITS.maxKeys);
      expect(limits.maxDepth).toBe(DEFAULT_CONTEXT_LIMITS.maxDepth);
    });
  });
});
