import type { Flow } from '../types/flow';
import type { ValidationIssue } from '../types/errors';

/**
 * Registry of flow definitions.
 */
export interface FlowRegistry {
  /** Register a flow (validates first) */
  register(flow: Flow): void;

  /** Get flow by ID (latest version if no version specified) */
  get(id: string, version?: string): Flow | undefined;

  /** Check if flow exists */
  has(id: string): boolean;

  /** List all flow IDs */
  flowIds(): string[];

  /** Get all versions of a flow, newest first */
  versions(id: string): string[];

  /** Validate without registering */
  validate(flow: Flow): ValidationIssue[];
}
