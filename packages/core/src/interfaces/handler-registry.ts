import type { StepHandler } from './step-handler';
import type { BaseHandler } from '../handlers/base';

/**
 * Constructor type for class-based handlers.
 */
export type HandlerConstructor<T extends BaseHandler = BaseHandler> = new () => T;

/**
 * A handler can be either:
 * - A class-based handler (constructor extending BaseHandler)
 * - A legacy StepHandler object (for backward compatibility during migration)
 */
export type HandlerLike = HandlerConstructor | StepHandler;

/**
 * Registry of step handlers.
 */
export interface HandlerRegistry {
  /** Register a handler (class constructor or legacy object) */
  register(handler: HandlerLike): void;

  /** Register multiple handlers */
  registerAll(handlers: HandlerLike[]): void;

  /** Get handler by type (always returns instance or legacy handler) */
  get(type: string): StepHandler | undefined;

  /** Get handler constructor by type (for class-based handlers) */
  getConstructor(type: string): HandlerConstructor | undefined;

  /** Check if handler is class-based */
  isClassBased(type: string): boolean;

  /** Check if type is registered */
  has(type: string): boolean;

  /** List all registered types */
  types(): string[];

  /** Unregister a handler by type */
  unregister(type: string): boolean;

  /** Get handler metadata */
  getMetadata(type: string): import('./step-handler').HandlerMetadata | undefined;

  /** Get all handler metadata */
  getAllMetadata(): import('./step-handler').HandlerMetadata[];

  /** List handlers by category */
  listByCategory(category?: string): import('./step-handler').HandlerMetadata[];

  /** Get stateful handlers metadata */
  getStateful(): import('./step-handler').HandlerMetadata[];

  /** Get stateless handlers metadata */
  getStateless(): import('./step-handler').HandlerMetadata[];

  /** Export a manifest suitable for GUI tooling */
  exportManifest(): { version: string; handlers: import('./step-handler').HandlerMetadata[]; categories: Record<string, import('./step-handler').HandlerMetadata[]> };

  /** Search handlers by query */
  search(query: string): import('./step-handler').HandlerMetadata[];
}
