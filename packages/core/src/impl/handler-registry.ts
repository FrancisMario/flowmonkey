import type { StepHandler, HandlerMetadata } from '../interfaces/step-handler';
import type { HandlerRegistry, HandlerLike, HandlerConstructor } from '../interfaces/handler-registry';
import { BaseHandler } from '../handlers/base';
import { getHandlerMetadata } from '../decorators/metadata';

/**
 * Represents a registered handler entry.
 */
type HandlerEntry =
  | {
      type: string;
      metadata: HandlerMetadata;
      isClassBased: true;
      constructor: HandlerConstructor;
      instance?: undefined;
    }
  | {
      type: string;
      metadata: HandlerMetadata;
      isClassBased: false;
      constructor?: undefined;
      instance: StepHandler;
    };

/**
 * Check if a value is a class constructor.
 */
function isConstructor(value: unknown): value is HandlerConstructor {
  return (
    typeof value === 'function' &&
    value.prototype &&
    value.prototype.constructor === value
  );
}

/**
 * Check if a constructor extends BaseHandler.
 */
function isHandlerClass(ctor: Function): ctor is HandlerConstructor {
  let proto = ctor.prototype;
  while (proto) {
    if (proto.constructor.name === 'BaseHandler') {
      return true;
    }
    proto = Object.getPrototypeOf(proto);
  }
  // Also check by duck typing - must have execute and the class should have @Handler decorator
  return (
    typeof ctor.prototype.execute === 'function' &&
    getHandlerMetadata(ctor) !== undefined
  );
}

export class DefaultHandlerRegistry implements HandlerRegistry {
  private entries = new Map<string, HandlerEntry>();

  register(handler: HandlerLike): void {
    let entry: HandlerEntry;

    if (isConstructor(handler) && isHandlerClass(handler)) {
      // Class-based handler
      const metadata = getHandlerMetadata(handler);
      if (!metadata) {
        throw new Error(
          `Handler class ${handler.name} is missing @Handler decorator`
        );
      }

      // Create a temporary instance to get full metadata
      const tempInstance = new handler();
      const fullMetadata = tempInstance.metadata;

      if (this.entries.has(fullMetadata.type)) {
        throw new Error(`Handler "${fullMetadata.type}" already registered`);
      }

      entry = {
        type: fullMetadata.type,
        metadata: fullMetadata,
        isClassBased: true as const,
        constructor: handler,
      };
    } else {
      // Legacy StepHandler object
      const legacyHandler = handler as StepHandler;
      if (this.entries.has(legacyHandler.type)) {
        throw new Error(`Handler "${legacyHandler.type}" already registered`);
      }

      entry = {
        type: legacyHandler.type,
        metadata: legacyHandler.metadata,
        isClassBased: false as const,
        constructor: undefined,
        instance: legacyHandler,
      };
    }

    this.entries.set(entry.type, entry);
  }

  registerAll(handlers: HandlerLike[]): void {
    handlers.forEach(h => this.register(h));
  }

  get(type: string): StepHandler | undefined {
    const entry = this.entries.get(type);
    if (!entry) return undefined;

    if (entry.isClassBased && entry.constructor) {
      // Create a new instance for each get() call
      // The engine will initialize it with context
      const instance = new entry.constructor();
      return this.wrapAsStepHandler(instance);
    }

    return entry.instance;
  }

  getConstructor(type: string): HandlerConstructor | undefined {
    const entry = this.entries.get(type);
    return entry?.isClassBased ? entry.constructor : undefined;
  }

  isClassBased(type: string): boolean {
    return this.entries.get(type)?.isClassBased ?? false;
  }

  /**
   * Wrap a BaseHandler instance as a StepHandler for engine compatibility.
   */
  private wrapAsStepHandler(handler: BaseHandler): StepHandler {
    return {
      type: handler.type,
      metadata: handler.metadata,
      stateful: handler.stateful,
      execute: async (params) => {
        // Initialize handler with context
        handler._init({
          step: params.step,
          execution: params.execution,
          ctx: params.ctx,
          tokenManager: params.tokenManager,
          signal: params.signal,
          vault: undefined, // Vault is injected at app layer
          context: params.context,
          resolvedInput: params.input,
        });

        // Resolve inputs from decorators
        await handler._resolveInputs();

        // Validate inputs
        const issues = handler._validateInputs();
        if (issues.length > 0) {
          return {
            outcome: 'failure',
            error: {
              code: 'INPUT_VALIDATION_FAILED',
              message: issues.map(i => `${i.path}: ${i.message}`).join('; '),
              details: issues,
            },
          };
        }

        // Execute
        return handler.execute();
      },
      validateConfig: handler.validateConfig.bind(handler),
      cleanup: handler.cleanup.bind(handler),
    };
  }

  has(type: string): boolean {
    return this.entries.has(type);
  }

  types(): string[] {
    return [...this.entries.keys()];
  }

  unregister(type: string): boolean {
    const entry = this.entries.get(type);
    if (entry?.instance?.cleanup) {
      entry.instance.cleanup().catch(() => undefined);
    }
    return this.entries.delete(type);
  }

  getMetadata(type: string): HandlerMetadata | undefined {
    return this.entries.get(type)?.metadata;
  }

  getAllMetadata(): HandlerMetadata[] {
    return Array.from(this.entries.values()).map(e => e.metadata);
  }

  listByCategory(category?: string): HandlerMetadata[] {
    if (!category) return this.getAllMetadata();
    return this.getAllMetadata().filter(m => m.category === category);
  }

  getStateful(): HandlerMetadata[] {
    return this.getAllMetadata().filter(m => m.stateful);
  }

  getStateless(): HandlerMetadata[] {
    return this.getAllMetadata().filter(m => !m.stateful);
  }

  exportManifest() {
    const handlers = this.getAllMetadata();
    const categories: Record<string, typeof handlers> = {};
    for (const h of handlers) {
      const cat = h.category || 'uncategorized';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(h);
    }

    return { version: '1.0.0', handlers, categories };
  }

  search(query: string) {
    const q = query.toLowerCase();
    return this.getAllMetadata().filter(m =>
      m.name.toLowerCase().includes(q) ||
      (m.description || '').toLowerCase().includes(q) ||
      (m.visual?.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }
}
