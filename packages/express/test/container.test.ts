/**
 * Tests for ServiceContainer.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServiceContainer } from '../src/container';

describe('ServiceContainer', () => {
  let container: ServiceContainer;

  beforeEach(() => {
    container = new ServiceContainer();
  });

  describe('registerInstance', () => {
    it('registers and resolves an instance', () => {
      const token = Symbol('test');
      const instance = { value: 42 };

      container.registerInstance(token, instance);
      const resolved = container.resolve<typeof instance>(token);

      expect(resolved).toBe(instance);
    });

    it('overwrites previous registration', () => {
      const token = Symbol('test');
      container.registerInstance(token, { value: 1 });
      container.registerInstance(token, { value: 2 });

      const resolved = container.resolve<{ value: number }>(token);
      expect(resolved.value).toBe(2);
    });

    it('supports method chaining', () => {
      const token1 = Symbol('test1');
      const token2 = Symbol('test2');

      const result = container
        .registerInstance(token1, { a: 1 })
        .registerInstance(token2, { b: 2 });

      expect(result).toBe(container);
      expect(container.has(token1)).toBe(true);
      expect(container.has(token2)).toBe(true);
    });
  });

  describe('registerFactory', () => {
    it('creates instance on first resolve', () => {
      const token = Symbol('test');
      const factory = vi.fn(() => ({ created: true }));

      container.registerFactory(token, factory);

      expect(factory).not.toHaveBeenCalled();

      const resolved = container.resolve<{ created: boolean }>(token);

      expect(factory).toHaveBeenCalledTimes(1);
      expect(resolved.created).toBe(true);
    });

    it('caches instance after first resolve (singleton)', () => {
      const token = Symbol('test');
      let callCount = 0;
      const factory = () => ({ id: ++callCount });

      container.registerFactory(token, factory);

      const first = container.resolve<{ id: number }>(token);
      const second = container.resolve<{ id: number }>(token);

      expect(first).toBe(second);
      expect(first.id).toBe(1);
    });

    it('passes container to factory', () => {
      const depToken = Symbol('dep');
      const mainToken = Symbol('main');

      container.registerInstance(depToken, { depValue: 'dependency' });
      container.registerFactory(mainToken, (c) => ({
        dep: c.resolve<{ depValue: string }>(depToken),
      }));

      const main = container.resolve<{ dep: { depValue: string } }>(mainToken);
      expect(main.dep.depValue).toBe('dependency');
    });
  });

  describe('resolve', () => {
    it('throws for unregistered token', () => {
      const token = Symbol('unregistered');

      expect(() => container.resolve(token)).toThrow('Service not registered');
    });

    it('includes token name in error message', () => {
      const token = Symbol('myService');

      expect(() => container.resolve(token)).toThrow('Symbol(myService)');
    });
  });

  describe('tryResolve', () => {
    it('returns undefined for unregistered token', () => {
      const token = Symbol('unregistered');

      const result = container.tryResolve(token);

      expect(result).toBeUndefined();
    });

    it('returns instance for registered token', () => {
      const token = Symbol('test');
      container.registerInstance(token, { value: 'test' });

      const result = container.tryResolve<{ value: string }>(token);

      expect(result?.value).toBe('test');
    });
  });

  describe('has', () => {
    it('returns false for unregistered token', () => {
      expect(container.has(Symbol('test'))).toBe(false);
    });

    it('returns true for registered token', () => {
      const token = Symbol('test');
      container.registerInstance(token, {});
      expect(container.has(token)).toBe(true);
    });
  });

  describe('clear', () => {
    it('removes all registered services', () => {
      const token1 = Symbol('test1');
      const token2 = Symbol('test2');

      container.registerInstance(token1, {});
      container.registerInstance(token2, {});

      container.clear();

      expect(container.has(token1)).toBe(false);
      expect(container.has(token2)).toBe(false);
    });
  });

  describe('getRegisteredTokens', () => {
    it('returns all registered tokens', () => {
      const token1 = Symbol('test1');
      const token2 = Symbol('test2');

      container.registerInstance(token1, {});
      container.registerInstance(token2, {});

      const tokens = container.getRegisteredTokens();

      expect(tokens).toContain(token1);
      expect(tokens).toContain(token2);
      expect(tokens.length).toBe(2);
    });
  });
});
