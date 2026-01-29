// ────────────────────────────────────────────────────────────────────────────
// Class-based handlers (new decorator system)
// ────────────────────────────────────────────────────────────────────────────

export {
  // Stateless handlers
  HttpHandler,
  TransformHandler,
  DelayHandler,
  // Stateful handlers
  EmailReplyHandler,
  FormSubmitHandler,
  BatchProcessHandler,
  // Handler list
  ClassHandlers,
} from './class';

// Re-export types from class-based handlers
export type {
  HttpSuccessOutput,
  HttpFailureOutput,
  TransformSuccessOutput,
  TransformFailureOutput,
  DelaySuccessOutput,
  EmailReplyCheckpoint,
  EmailReplySuccessOutput,
  EmailReplyFailureOutput,
  FormSubmitCheckpoint,
  FormField,
  FormSubmitSuccessOutput,
  FormSubmitFailureOutput,
  BatchProcessCheckpoint,
  BatchItemResult,
  BatchProcessSuccessOutput,
  BatchProcessFailureOutput,
} from './class';

// ────────────────────────────────────────────────────────────────────────────
// Legacy functional handlers (deprecated - use class-based handlers instead)
// ────────────────────────────────────────────────────────────────────────────

/** @deprecated Use HttpHandler class instead */
export { httpHandler } from './http';
/** @deprecated Use DelayHandler class instead */
export { delayHandler } from './delay';
/** @deprecated Use TransformHandler class instead */
export { transformHandler } from './transform';

/** @deprecated Use EmailReplyHandler class instead */
export { emailReplyHandler } from './email-reply';
/** @deprecated Use FormSubmitHandler class instead */
export { formSubmitHandler } from './form-submit';

/** @deprecated Use BatchProcessHandler class instead */
export { batchProcessHandler } from './batch-process';

/** @deprecated These handlers will be migrated to class-based */
export { llmHandler, webhookHandler } from './handlers';

// ────────────────────────────────────────────────────────────────────────────
// Test utilities
// ────────────────────────────────────────────────────────────────────────────

export { createMockParams, testHandler, assertSuccess, assertFailure, assertWaiting } from './test-helpers';
