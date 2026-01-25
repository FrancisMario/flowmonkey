/**
 * JSON Schema type (subset for trigger validation)
 */
export type JSONSchema = {
  type?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  format?: string;
  additionalProperties?: boolean | JSONSchema;
  [key: string]: unknown;
};

/**
 * Base trigger properties shared by all trigger types.
 */
export interface BaseTrigger {
  id: string;
  name: string;
  description?: string;
  flowId: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * HTTP trigger - receives external webhooks/API calls.
 */
export interface HttpTrigger extends BaseTrigger {
  type: 'http';

  /**
   * JSON Schema for validating incoming requests.
   */
  inputSchema: JSONSchema;

  /**
   * Key in flow context where validated payload is stored.
   * e.g., "order" → context.order = payload
   */
  contextKey: string;
}

/**
 * Schedule trigger - runs on a cron schedule.
 */
export interface ScheduleTrigger extends BaseTrigger {
  type: 'schedule';

  /**
   * Cron expression (5 or 6 fields).
   * e.g., "0 9 * * *" = daily at 9am
   */
  schedule: string;

  /**
   * Timezone for cron evaluation.
   * Default: 'UTC'
   */
  timezone: string;

  /**
   * Static context passed to flow on each run.
   */
  staticContext: Record<string, unknown>;

  /**
   * Last successful run timestamp.
   */
  lastRunAt?: number;

  /**
   * Computed next run timestamp.
   */
  nextRunAt?: number;
}

/**
 * Union of all trigger types.
 */
export type Trigger = HttpTrigger | ScheduleTrigger;

/**
 * Validation error from JSON Schema validation.
 */
export interface ValidationError {
  /** JSON path to field, e.g., "customer.email" */
  path: string;
  /** Human-readable error message */
  message: string;
  /** JSON Schema keyword, e.g., "required", "format" */
  keyword: string;
}

/**
 * History record for trigger invocations.
 */
export interface TriggerHistoryRecord {
  id: number;
  triggerId: string;
  /** null if failed before execution created */
  executionId?: string;

  status: 'success' | 'validation_failed' | 'flow_not_found' | 'error';

  /** HTTP request details */
  requestBody?: unknown;
  requestHeaders?: Record<string, string>;
  requestIp?: string;

  /** Validation errors */
  validationErrors?: ValidationError[];

  /** Error details */
  errorCode?: string;
  errorMessage?: string;

  /** Timing */
  durationMs: number;
  timestamp: number;
}

/**
 * Aggregated stats for a trigger.
 */
export interface TriggerStats {
  total: number;
  success: number;
  validationFailed: number;
  flowNotFound: number;
  error: number;
  avgDurationMs: number;
}

/**
 * Trigger store interface.
 */
export interface TriggerStore {
  // CRUD
  create(trigger: CreateTrigger): Promise<Trigger>;
  get(id: string): Promise<Trigger | null>;
  update(id: string, updates: Partial<Trigger>): Promise<Trigger | null>;
  delete(id: string): Promise<boolean>;

  // Queries
  list(options?: {
    flowId?: string;
    type?: 'http' | 'schedule';
    enabled?: boolean;
  }): Promise<Trigger[]>;
  listDueSchedules(now: number): Promise<ScheduleTrigger[]>;

  // Schedule management
  updateScheduleRun(id: string, lastRunAt: number, nextRunAt: number): Promise<void>;

  // History
  logInvocation(record: Omit<TriggerHistoryRecord, 'id'>): Promise<void>;
  getHistory(
    triggerId: string,
    options?: { limit?: number; status?: string }
  ): Promise<TriggerHistoryRecord[]>;
  getHistoryStats(triggerId: string, since: number): Promise<TriggerStats>;
}

/**
 * Wake signaler interface for notifying workers.
 */
export interface WakeSignaler {
  signal(executionId: string): Promise<void>;
}

/**
 * Result from trigger HTTP handler.
 */
export interface TriggerResult {
  status: number;
  body: unknown;
}

/**
 * Input for creating an HTTP trigger.
 */
export type CreateHttpTrigger = Omit<HttpTrigger, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Input for creating a schedule trigger.
 */
export type CreateScheduleTrigger = Omit<ScheduleTrigger, 'id' | 'createdAt' | 'updatedAt' | 'lastRunAt' | 'nextRunAt'>;

/**
 * Input for creating any trigger.
 */
export type CreateTrigger = CreateHttpTrigger | CreateScheduleTrigger;
