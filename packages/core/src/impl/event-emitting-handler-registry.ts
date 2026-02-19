/**
 * EventEmittingHandlerRegistry — decorator that wraps any HandlerRegistry
 * and emits lifecycle events on register/unregister.
 */

import type { StepHandler, HandlerMetadata } from '../interfaces/step-handler';
import type { HandlerRegistry, HandlerLike, HandlerConstructor } from '../interfaces/handler-registry';
import type { EventBus } from '../interfaces/event-bus';

export class EventEmittingHandlerRegistry implements HandlerRegistry {
  constructor(
    private readonly inner: HandlerRegistry,
    private readonly events: EventBus
  ) {}

  register(handler: HandlerLike): void {
    this.inner.register(handler);

    // After successful registration, figure out the type that was registered
    // Use the inner registry to get the metadata for the most recently added type
    const meta = this.resolveMetadata(handler);
    this.events.onHandlerRegistered?.({
      handlerType: meta?.type ?? 'unknown',
      name: meta?.name,
      category: meta?.category,
    });
  }

  registerAll(handlers: HandlerLike[]): void {
    handlers.forEach(h => this.register(h));
  }

  get(type: string): StepHandler | undefined {
    return this.inner.get(type);
  }

  getConstructor(type: string): HandlerConstructor | undefined {
    return this.inner.getConstructor(type);
  }

  isClassBased(type: string): boolean {
    return this.inner.isClassBased(type);
  }

  has(type: string): boolean {
    return this.inner.has(type);
  }

  types(): string[] {
    return this.inner.types();
  }

  unregister(type: string): boolean {
    const ok = this.inner.unregister(type);
    if (ok) {
      this.events.onHandlerUnregistered?.({ handlerType: type });
    }
    return ok;
  }

  getMetadata(type: string): HandlerMetadata | undefined {
    return this.inner.getMetadata(type);
  }

  getAllMetadata(): HandlerMetadata[] {
    return this.inner.getAllMetadata();
  }

  listByCategory(category?: string): HandlerMetadata[] {
    return this.inner.listByCategory(category);
  }

  getStateful(): HandlerMetadata[] {
    return this.inner.getStateful();
  }

  getStateless(): HandlerMetadata[] {
    return this.inner.getStateless();
  }

  exportManifest() {
    return this.inner.exportManifest();
  }

  search(query: string) {
    return this.inner.search(query);
  }

  /** Resolve metadata from a HandlerLike value */
  private resolveMetadata(handler: HandlerLike): HandlerMetadata | undefined {
    if (typeof handler === 'function') {
      // Class-based — after registration the inner should have it
      // Try to get it via types list (last added)
      const types = this.inner.types();
      if (types.length > 0) {
        return this.inner.getMetadata(types[types.length - 1]);
      }
      return undefined;
    }
    // Legacy StepHandler object
    const sh = handler as StepHandler;
    return sh.metadata ?? { type: sh.type, name: sh.type, category: 'utility' as const, stateful: false, inputs: [], outputs: { success: { type: 'object', properties: {} }, failure: { type: 'object', properties: {} } } };
  }
}
