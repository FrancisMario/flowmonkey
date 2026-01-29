/**
 * Class-based handlers using the decorator system.
 *
 * This module exports all class-based handler implementations.
 */

// Stateless Handlers
export { HttpHandler } from './http';
export type { HttpSuccessOutput, HttpFailureOutput } from './http';

export { TransformHandler } from './transform';
export type { TransformSuccessOutput, TransformFailureOutput } from './transform';

export { DelayHandler } from './delay';
export type { DelaySuccessOutput } from './delay';

// Stateful Handlers
export { EmailReplyHandler } from './email-reply';
export type {
  EmailReplyCheckpoint,
  EmailReplySuccessOutput,
  EmailReplyFailureOutput,
} from './email-reply';

export { FormSubmitHandler } from './form-submit';
export type {
  FormSubmitCheckpoint,
  FormField,
  FormSubmitSuccessOutput,
  FormSubmitFailureOutput,
} from './form-submit';

export { BatchProcessHandler } from './batch-process';
export type {
  BatchProcessCheckpoint,
  BatchItemResult,
  BatchProcessSuccessOutput,
  BatchProcessFailureOutput,
} from './batch-process';

/**
 * All class-based handlers for easy registration
 */
export const ClassHandlers = [
  // Stateless
  'HttpHandler',
  'TransformHandler',
  'DelayHandler',
  // Stateful
  'EmailReplyHandler',
  'FormSubmitHandler',
  'BatchProcessHandler',
] as const;
