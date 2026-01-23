import type { StepHandler } from '../interfaces/step-handler';
import type { HandlerRegistry } from '../interfaces/handler-registry';

export class DefaultHandlerRegistry implements HandlerRegistry {
  private handlers = new Map<string, StepHandler>();

  register(handler: StepHandler): void {
    if (this.handlers.has(handler.type)) {
      throw new Error(`Handler "${handler.type}" already registered`);
    }
    this.handlers.set(handler.type, handler);
  }

  registerAll(handlers: StepHandler[]): void {
    handlers.forEach(h => this.register(h));
  }

  get(type: string): StepHandler | undefined {
    return this.handlers.get(type);
  }

  has(type: string): boolean {
    return this.handlers.has(type);
  }

  types(): string[] {
    return [...this.handlers.keys()];
  }
}
