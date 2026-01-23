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
}
