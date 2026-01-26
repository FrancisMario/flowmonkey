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

  unregister(type: string): boolean {
    const h = this.handlers.get(type);
    if (h?.cleanup) {
      h.cleanup().catch(() => undefined);
    }
    return this.handlers.delete(type);
  }

  getMetadata(type: string) {
    return this.handlers.get(type)?.metadata;
  }

  getAllMetadata() {
    return Array.from(this.handlers.values()).map(h => h.metadata);
  }

  listByCategory(category?: string) {
    if (!category) return this.getAllMetadata();
    return this.getAllMetadata().filter(m => m.category === category);
  }

  getStateful() {
    return this.getAllMetadata().filter(m => m.stateful);
  }

  getStateless() {
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
