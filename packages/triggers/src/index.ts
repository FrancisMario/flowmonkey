// Types
export type {
  Trigger,
  HttpTrigger,
  ScheduleTrigger,
  TriggerStore,
  TriggerHistoryRecord,
  TriggerStats,
  ValidationError,
  WakeSignaler,
  TriggerResult,
  JSONSchema,
  CreateTrigger,
  CreateHttpTrigger,
  CreateScheduleTrigger,
} from './types';

// Store
export { PgTriggerStore, MemoryTriggerStore } from './store';

// HTTP Handler
export { handleTrigger, clearSchemaCache, type TriggerHandlerDeps, type RequestMeta } from './http-handler';

// Schedule Runner
export { ScheduleRunner, type ScheduleRunnerOptions, type ScheduleRunnerDeps } from './schedule-runner';

// Unified Service
export {
  TriggerService,
  type TriggerServiceOptions,
  type TriggerServiceConfig,
  type HttpAdapterConfig,
  type ScheduleAdapterConfig,
  type FireResult,
  type TriggerFilter,
  type TriggerServiceEvents,
} from './trigger-service';

// Schema
export { triggerSchema, applyTriggerSchema, applyTriggerMigrationV010, TRIGGER_SCHEMA_VERSION } from './schema';
