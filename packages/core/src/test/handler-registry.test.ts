/**
 * Handler Registry Tests
 *
 * Tests for DefaultHandlerRegistry covering:
 * - Handler registration and retrieval
 * - Metadata management
 * - Category and stateful filtering
 * - Manifest export for GUI tooling
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DefaultHandlerRegistry } from '../impl/handler-registry';
import type { StepHandler, HandlerMetadata } from '../interfaces/step-handler';
import { Result } from '../types/result';

/**
 * Helper to create test handlers with configurable metadata.
 */
function createHandler(type: string, metadata?: Partial<HandlerMetadata>): StepHandler {
  return {
    type,
    metadata: {
      type,
      name: metadata?.name ?? type,
      description: metadata?.description,
      category: metadata?.category,
      stateful: metadata?.stateful ?? false,
      configSchema: metadata?.configSchema ?? { type: 'object' },
      inputSchema: metadata?.inputSchema,
      outputSchema: metadata?.outputSchema,
    },
    async execute() {
      return Result.success(null);
    },
  };
}

describe('DefaultHandlerRegistry', () => {
  let registry: DefaultHandlerRegistry;

  beforeEach(() => {
    registry = new DefaultHandlerRegistry();
  });

  describe('registration', () => {
    it('registers a handler', () => {
      const handler = createHandler('test');
      registry.register(handler);

      expect(registry.has('test')).toBe(true);
      expect(registry.get('test')).toBe(handler);
    });

    it('throws on duplicate registration', () => {
      const handler1 = createHandler('test');
      const handler2 = createHandler('test');
      
      registry.register(handler1);
      expect(() => registry.register(handler2)).toThrow('already registered');
    });

    it('registers multiple handlers', () => {
      registry.register(createHandler('type-a'));
      registry.register(createHandler('type-b'));
      registry.register(createHandler('type-c'));

      expect(registry.types()).toHaveLength(3);
      expect(registry.types()).toContain('type-a');
      expect(registry.types()).toContain('type-b');
      expect(registry.types()).toContain('type-c');
    });
  });

  describe('retrieval', () => {
    it('returns undefined for unregistered type', () => {
      expect(registry.get('unknown')).toBeUndefined();
    });

    it('has() returns false for unregistered type', () => {
      expect(registry.has('unknown')).toBe(false);
    });
  });

  describe('types()', () => {
    it('returns empty array when no handlers registered', () => {
      expect(registry.types()).toEqual([]);
    });

    it('returns all registered types', () => {
      registry.register(createHandler('http'));
      registry.register(createHandler('delay'));
      registry.register(createHandler('transform'));

      const types = registry.types();
      expect(types).toHaveLength(3);
      expect(types.sort()).toEqual(['delay', 'http', 'transform']);
    });
  });

  describe('metadata', () => {
    it('returns metadata for registered handler', () => {
      const handler = createHandler('http', {
        name: 'HTTP Request',
        description: 'Make HTTP requests',
        category: 'external',
      });
      registry.register(handler);

      const metadata = registry.getMetadata('http');
      expect(metadata).toEqual({
        type: 'http',
        name: 'HTTP Request',
        description: 'Make HTTP requests',
        category: 'external',
        stateful: false,
        configSchema: { type: 'object' },
        inputSchema: undefined,
        outputSchema: undefined,
      });
    });

    it('returns undefined metadata for unregistered type', () => {
      expect(registry.getMetadata('unknown')).toBeUndefined();
    });

    it('getAllMetadata returns all handler metadata', () => {
      registry.register(createHandler('type-a', { name: 'Type A' }));
      registry.register(createHandler('type-b', { name: 'Type B' }));

      const all = registry.getAllMetadata();
      expect(all).toHaveLength(2);
      expect(all.map(m => m.type).sort()).toEqual(['type-a', 'type-b']);
    });
  });

  describe('category filtering', () => {
    beforeEach(() => {
      registry.register(createHandler('http', { category: 'external' }));
      registry.register(createHandler('delay', { category: 'control' }));
      registry.register(createHandler('branch', { category: 'control' }));
      registry.register(createHandler('transform', { category: 'data' }));
      registry.register(createHandler('unknown', {})); // No category
    });

    it('filters metadata by category', () => {
      const control = registry.listByCategory('control');
      expect(control).toHaveLength(2);
      expect(control.map(m => m.type).sort()).toEqual(['branch', 'delay']);
    });

    it('returns empty array for non-existent category', () => {
      const result = registry.listByCategory('non-existent');
      expect(result).toEqual([]);
    });
  });

  describe('stateful filtering', () => {
    beforeEach(() => {
      registry.register(createHandler('http', { stateful: false }));
      registry.register(createHandler('delay', { stateful: false }));
      registry.register(createHandler('webhook', { stateful: true }));
      registry.register(createHandler('batch', { stateful: true }));
    });

    it('getStateful returns only stateful handler metadata', () => {
      const stateful = registry.getStateful();
      expect(stateful).toHaveLength(2);
      expect(stateful.map(m => m.type).sort()).toEqual(['batch', 'webhook']);
    });

    it('getStateless returns only stateless handler metadata', () => {
      const stateless = registry.getStateless();
      expect(stateless).toHaveLength(2);
      expect(stateless.map(m => m.type).sort()).toEqual(['delay', 'http']);
    });
  });

  describe('manifest export', () => {
    beforeEach(() => {
      registry.register(createHandler('http', {
        name: 'HTTP Request',
        description: 'Make HTTP calls',
        category: 'external',
        stateful: false,
        configSchema: { 
          type: 'object',
          properties: {
            url: { type: 'string' },
            method: { type: 'string', enum: ['GET', 'POST'] },
          },
        },
      }));
      
      registry.register(createHandler('webhook', {
        name: 'Wait for Webhook',
        description: 'Wait for external callback',
        category: 'external',
        stateful: true,
      }));
    });

    it('exports complete manifest with version, handlers, and categories', () => {
      const manifest = registry.exportManifest();

      expect(manifest.version).toBe('1.0.0');
      expect(manifest.handlers).toHaveLength(2);
      
      const httpMetadata = manifest.handlers.find(m => m.type === 'http');
      expect(httpMetadata?.name).toBe('HTTP Request');
      expect(httpMetadata?.description).toBe('Make HTTP calls');
      expect(httpMetadata?.category).toBe('external');
      expect(httpMetadata?.stateful).toBe(false);

      const webhookMetadata = manifest.handlers.find(m => m.type === 'webhook');
      expect(webhookMetadata?.stateful).toBe(true);

      // Categories should group handlers
      expect(manifest.categories['external']).toHaveLength(2);
    });
  });
});
