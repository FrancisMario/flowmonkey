import type { StepHandler } from './step-handler';

/**
 * Registry of step handlers.
 */
export interface HandlerRegistry {
  /** Register a handler */
  register(handler: StepHandler): void;

  /** Register multiple handlers */
  registerAll(handlers: StepHandler[]): void;

  /** Get handler by type */
  get(type: string): StepHandler | undefined;

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
