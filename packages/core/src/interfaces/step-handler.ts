import type { Step } from '../types/flow';
import type { StepResult } from '../types/result';
import type { Execution } from '../types/execution';

/**
 * Minimal JSON Schema subset used for handler metadata.
 */
export type JSONSchema = {
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  description?: string;
  default?: unknown;
  additionalProperties?: boolean | JSONSchema;
  [key: string]: unknown;
};

export interface HandlerMetadata {
  type: string;
  name: string;
  description?: string;
  category?: 'control' | 'data' | 'external' | 'ai' | 'utility';
  stateful?: boolean;
  version?: string;
  deprecated?: boolean | { since: string; message?: string; useInstead?: string };
  visual?: { icon?: string; color?: string; tags?: string[] };
  configSchema: JSONSchema;
  inputSchema?: JSONSchema;
  outputSchema?: JSONSchema;
  defaultTimeout?: number;
  retryable?: boolean;
  examples?: Array<{ name: string; description?: string; config: Record<string, unknown>; input?: unknown; expectedOutput?: unknown }>;
  links?: { docs?: string; source?: string };
}

export interface ContextReference {
  _ref: string;
  summary?: string;
  size: number;
  type?: string;
  createdAt: number;
}

export type StorageTier = 'inline' | 'external';

export interface ContextSetOptions {
  tier?: StorageTier;
  force?: boolean;
  summary?: string;
}

export interface ContextStorage {
  set(executionId: string, key: string, value: unknown): Promise<ContextReference>;
  get(executionId: string, key: string): Promise<unknown>;
  delete(executionId: string, key: string): Promise<void>;
  list(executionId: string): Promise<string[]>;
  cleanup(executionId: string): Promise<void>;
}

export interface CheckpointManager {
  save(key: string, data: unknown): Promise<void>;
  restore<T = unknown>(key: string): Promise<T | null>;
  list(): Promise<string[]>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export interface ContextHelpers {
  get<T = unknown>(key: string): Promise<T>;
  set(key: string, value: unknown, options?: ContextSetOptions): Promise<void>;
  has(key: string): boolean;
  delete(key: string): Promise<void>;
  getAll<T = Record<string, unknown>>(keys: string[]): Promise<T>;
}

export interface HandlerParams {
  step: Step;
  input: unknown;
  context: Record<string, unknown>;
  ctx: ContextHelpers;
  execution: Execution;
  checkpoints?: CheckpointManager;
  tokenManager?: import('./resume-token-manager').ResumeTokenManager | undefined;
  signal?: AbortSignal;
}

export interface WaitingResult {
  outcome: 'wait' | 'waiting' | 'waited';
  waitReason?: string;
  resumeToken?: string;
  wakeAt?: number;
  waitData?: Record<string, unknown>;
  output?: unknown;
}

export interface StepHandler {
  readonly type: string;
  readonly metadata: HandlerMetadata;
  readonly stateful?: boolean;
  execute(params: HandlerParams): Promise<StepResult>;
  validateConfig?(config: Record<string, unknown>): Promise<import('../types/errors').ValidationIssue[] | undefined>;
  cleanup?(): Promise<void>;
}
