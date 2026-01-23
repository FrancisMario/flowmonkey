import type { Flow } from '../types/flow';
import type { FlowRegistry } from '../interfaces/flow-registry';
import type { ValidationIssue } from '../types/errors';
import { FlowValidationError } from '../types/errors';
import { validateFlow } from '../utils/validation';

export class DefaultFlowRegistry implements FlowRegistry {
  private flows = new Map<string, Map<string, Flow>>();
  private latest = new Map<string, string>();

  register(flow: Flow): void {
    const issues = this.validate(flow);
    if (issues.some(i => i.severity === 'error')) {
      throw new FlowValidationError(flow.id, issues);
    }

    let versions = this.flows.get(flow.id);
    if (!versions) {
      versions = new Map();
      this.flows.set(flow.id, versions);
    }

    if (versions.has(flow.version)) {
      throw new Error(`Flow "${flow.id}@${flow.version}" already registered`);
    }

    versions.set(flow.version, flow);

    const current = this.latest.get(flow.id);
    if (!current || flow.version > current) {
      this.latest.set(flow.id, flow.version);
    }
  }

  get(id: string, version?: string): Flow | undefined {
    const versions = this.flows.get(id);
    if (!versions) return undefined;
    return version ? versions.get(version) : versions.get(this.latest.get(id)!);
  }

  has(id: string): boolean {
    return this.flows.has(id);
  }

  flowIds(): string[] {
    return [...this.flows.keys()];
  }

  validate(flow: Flow): ValidationIssue[] {
    return validateFlow(flow);
  }
}
