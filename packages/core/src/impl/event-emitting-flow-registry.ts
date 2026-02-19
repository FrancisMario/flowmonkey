/**
 * EventEmittingFlowRegistry — decorator that wraps any FlowRegistry
 * and emits lifecycle events on mutations.
 */

import type { Flow } from '../types/flow';
import type { ValidationIssue } from '../types/errors';
import type { FlowRegistry } from '../interfaces/flow-registry';
import type { EventBus } from '../interfaces/event-bus';

export class EventEmittingFlowRegistry implements FlowRegistry {
  constructor(
    private readonly inner: FlowRegistry,
    private readonly events: EventBus
  ) {}

  register(flow: Flow): void {
    this.inner.register(flow);
    this.events.onFlowRegistered?.({ flowId: flow.id, version: flow.version });
  }

  get(id: string, version?: string): Flow | undefined {
    return this.inner.get(id, version);
  }

  has(id: string): boolean {
    return this.inner.has(id);
  }

  flowIds(): string[] {
    return this.inner.flowIds();
  }

  versions(id: string): string[] {
    return this.inner.versions(id);
  }

  validate(flow: Flow): ValidationIssue[] {
    return this.inner.validate(flow);
  }
}
