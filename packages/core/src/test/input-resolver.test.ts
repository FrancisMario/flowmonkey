/**
 * Input Resolver Tests
 *
 * Tests for all six input selector types:
 * - key: Single context key lookup
 * - keys: Multiple keys as object subset
 * - path: Dot-notation deep path access
 * - template: String interpolation with ${var} syntax
 * - full: Entire context (shallow copy)
 * - static: Literal value passthrough
 *
 * @see README.md for full test documentation
 */
import { describe, it, expect } from 'vitest';
import { resolveInput } from '../engine/input-resolver';
import type { InputSelector } from '../types/flow';

describe('resolveInput', () => {
  describe('key selector', () => {
    it('returns value for existing key', () => {
      const context = { name: 'Alice', age: 30 };
      const selector: InputSelector = { type: 'key', key: 'name' };

      expect(resolveInput(selector, context)).toBe('Alice');
    });

    it('returns undefined for missing key', () => {
      const context = { name: 'Alice' };
      const selector: InputSelector = { type: 'key', key: 'missing' };

      expect(resolveInput(selector, context)).toBeUndefined();
    });
  });

  describe('keys selector', () => {
    it('returns object with selected keys', () => {
      const context = { name: 'Alice', age: 30, city: 'NYC' };
      const selector: InputSelector = { type: 'keys', keys: ['name', 'age'] };

      expect(resolveInput(selector, context)).toEqual({ name: 'Alice', age: 30 });
    });

    it('omits missing keys', () => {
      const context = { name: 'Alice' };
      const selector: InputSelector = { type: 'keys', keys: ['name', 'missing'] };

      expect(resolveInput(selector, context)).toEqual({ name: 'Alice' });
    });

    it('returns empty object when no keys exist', () => {
      const context = { other: 'value' };
      const selector: InputSelector = { type: 'keys', keys: ['missing1', 'missing2'] };

      expect(resolveInput(selector, context)).toEqual({});
    });
  });

  describe('path selector', () => {
    it('resolves simple path', () => {
      const context = { user: { name: 'Alice' } };
      const selector: InputSelector = { type: 'path', path: 'user.name' };

      expect(resolveInput(selector, context)).toBe('Alice');
    });

    it('resolves deep path', () => {
      const context = { a: { b: { c: { d: 'value' } } } };
      const selector: InputSelector = { type: 'path', path: 'a.b.c.d' };

      expect(resolveInput(selector, context)).toBe('value');
    });

    it('returns undefined for missing path', () => {
      const context = { user: { name: 'Alice' } };
      const selector: InputSelector = { type: 'path', path: 'user.address.city' };

      expect(resolveInput(selector, context)).toBeUndefined();
    });

    it('returns undefined when path hits null', () => {
      const context = { user: null };
      const selector: InputSelector = { type: 'path', path: 'user.name' };

      expect(resolveInput(selector, context)).toBeUndefined();
    });
  });

  describe('template selector', () => {
    it('interpolates simple string template', () => {
      const context = { name: 'Alice', city: 'NYC' };
      const selector: InputSelector = { type: 'template', template: 'Hello ${name} from ${city}!' };

      expect(resolveInput(selector, context)).toBe('Hello Alice from NYC!');
    });

    it('replaces full expression with actual value type', () => {
      const context = { count: 42 };
      const selector: InputSelector = { type: 'template', template: '${count}' };

      expect(resolveInput(selector, context)).toBe(42);
    });

    it('interpolates object template', () => {
      const context = { name: 'Alice', age: 30 };
      const selector: InputSelector = {
        type: 'template',
        template: {
          greeting: 'Hello ${name}',
          details: {
            userAge: '${age}',
          },
        },
      };

      expect(resolveInput(selector, context)).toEqual({
        greeting: 'Hello Alice',
        details: {
          userAge: 30,
        },
      });
    });

    it('interpolates array template', () => {
      const context = { a: 1, b: 2 };
      const selector: InputSelector = {
        type: 'template',
        template: ['${a}', '${b}', 'literal'],
      };

      expect(resolveInput(selector, context)).toEqual([1, 2, 'literal']);
    });

    it('replaces missing values with empty string', () => {
      const context = { name: 'Alice' };
      const selector: InputSelector = { type: 'template', template: 'Hello ${name}, age ${age}' };

      expect(resolveInput(selector, context)).toBe('Hello Alice, age ');
    });

    it('uses path syntax in template', () => {
      const context = { user: { name: 'Alice' } };
      const selector: InputSelector = { type: 'template', template: 'Hello ${user.name}!' };

      expect(resolveInput(selector, context)).toBe('Hello Alice!');
    });

    it('returns non-string/array/object templates as-is', () => {
      const context = {};
      const selector: InputSelector = { type: 'template', template: 123 };

      expect(resolveInput(selector, context)).toBe(123);
    });
  });

  describe('full selector', () => {
    it('returns shallow copy of entire context', () => {
      const context = { name: 'Alice', age: 30 };
      const selector: InputSelector = { type: 'full' };

      const result = resolveInput(selector, context);

      expect(result).toEqual({ name: 'Alice', age: 30 });
      expect(result).not.toBe(context); // Should be a copy
    });
  });

  describe('static selector', () => {
    it('returns static value', () => {
      const context = { name: 'Alice' };
      const selector: InputSelector = { type: 'static', value: { fixed: 'data' } };

      expect(resolveInput(selector, context)).toEqual({ fixed: 'data' });
    });

    it('returns null static value', () => {
      const context = {};
      const selector: InputSelector = { type: 'static', value: null };

      expect(resolveInput(selector, context)).toBeNull();
    });

    it('returns primitive static value', () => {
      const context = {};
      const selector: InputSelector = { type: 'static', value: 42 };

      expect(resolveInput(selector, context)).toBe(42);
    });
  });
});
