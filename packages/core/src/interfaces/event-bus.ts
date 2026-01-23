import type { StepResult } from '../types/result';

/**
 * Optional event publishing.
 * Implement for logging, metrics, webhooks, etc.
 */
export interface EventBus {
  onExecutionCreated?(e: { executionId: string; flowId: string; context: Record<string, unknown> }): void;
  onExecutionStarted?(e: { executionId: string; flowId: string; stepId: string }): void;
  onStepStarted?(e: { executionId: string; stepId: string; input: unknown }): void;
  onStepCompleted?(e: { executionId: string; stepId: string; result: StepResult; durationMs: number }): void;
  onExecutionCompleted?(e: { executionId: string; context: Record<string, unknown>; totalSteps: number }): void;
  onExecutionFailed?(e: { executionId: string; stepId: string; error: { code: string; message: string } }): void;
  onExecutionWaiting?(e: { executionId: string; stepId: string; wakeAt?: number; reason?: string }): void;
}
