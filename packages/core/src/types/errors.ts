/**
 * Base error for all FlowMonkey errors.
 */
export class FlowMonkeyError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'FlowMonkeyError';
  }
}

/**
 * Flow definition is invalid.
 */
export class FlowValidationError extends FlowMonkeyError {
  constructor(
    public readonly flowId: string,
    public readonly issues: ValidationIssue[]
  ) {
    super('FLOW_INVALID', `Flow "${flowId}" is invalid: ${issues[0]?.message}`);
    this.name = 'FlowValidationError';
  }
}

/**
 * Execution is in an unexpected state.
 */
export class ExecutionError extends FlowMonkeyError {
  constructor(
    code: string,
    public readonly executionId: string,
    message: string
  ) {
    super(code, message);
    this.name = 'ExecutionError';
  }
}

/**
 * Execution was not found.
 */
export class ExecutionNotFoundError extends ExecutionError {
  constructor(executionId: string) {
    super('EXECUTION_NOT_FOUND', executionId, `Execution "${executionId}" not found`);
    this.name = 'ExecutionNotFoundError';
  }
}

/**
 * Execution is not in waiting status.
 */
export class ExecutionNotWaitingError extends ExecutionError {
  constructor(executionId: string, actualStatus: string) {
    super('EXECUTION_NOT_WAITING', executionId, `Execution "${executionId}" is not waiting (status: ${actualStatus})`);
    this.name = 'ExecutionNotWaitingError';
  }
}

/**
 * Execution has been cancelled.
 */
export class ExecutionCancelledError extends ExecutionError {
  constructor(executionId: string) {
    super('EXECUTION_CANCELLED', executionId, `Execution "${executionId}" has been cancelled`);
    this.name = 'ExecutionCancelledError';
  }
}

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
  readonly severity: 'error' | 'warning';
}

// === Context Limit Errors ===

/**
 * Base class for context limit errors.
 */
export class ContextLimitError extends FlowMonkeyError {
  constructor(
    code: string,
    message: string,
    public readonly limit: number,
    public readonly actual: number
  ) {
    super(code, message);
    this.name = 'ContextLimitError';
  }
}

/**
 * Single context value exceeds size limit.
 */
export class ContextValueTooLargeError extends ContextLimitError {
  constructor(
    public readonly key: string,
    actual: number,
    limit: number
  ) {
    super(
      'CONTEXT_VALUE_TOO_LARGE',
      `Context value for key "${key}" is ${actual} bytes, exceeds limit of ${limit} bytes`,
      limit,
      actual
    );
    this.name = 'ContextValueTooLargeError';
  }
}

/**
 * Total context size exceeds limit.
 */
export class ContextSizeLimitError extends ContextLimitError {
  constructor(
    currentSize: number,
    attemptedAddition: number,
    limit: number
  ) {
    super(
      'CONTEXT_SIZE_LIMIT',
      `Adding ${attemptedAddition} bytes would exceed total context limit of ${limit} bytes (current: ${currentSize})`,
      limit,
      currentSize + attemptedAddition
    );
    this.name = 'ContextSizeLimitError';
  }
}

/**
 * Too many keys in context.
 */
export class ContextKeyLimitError extends ContextLimitError {
  constructor(actual: number, limit: number) {
    super(
      'CONTEXT_KEY_LIMIT',
      `Context has ${actual} keys, exceeds limit of ${limit}`,
      limit,
      actual
    );
    this.name = 'ContextKeyLimitError';
  }
}

/**
 * Context value nesting too deep.
 */
export class ContextNestingError extends ContextLimitError {
  constructor(
    public readonly key: string,
    actual: number,
    limit: number
  ) {
    super(
      'CONTEXT_NESTING_LIMIT',
      `Context value for key "${key}" has nesting depth of ${actual}, exceeds limit of ${limit}`,
      limit,
      actual
    );
    this.name = 'ContextNestingError';
  }
}

// === Resume Token Errors ===

/**
 * Resume token is invalid or not found.
 */
export class InvalidResumeTokenError extends FlowMonkeyError {
  constructor(
    public readonly token: string,
    reason: string
  ) {
    super('INVALID_RESUME_TOKEN', `Invalid resume token: ${reason}`);
    this.name = 'InvalidResumeTokenError';
  }
}

/**
 * Resume token has expired.
 */
export class ResumeTokenExpiredError extends FlowMonkeyError {
  constructor(public readonly token: string) {
    super('RESUME_TOKEN_EXPIRED', 'Resume token has expired');
    this.name = 'ResumeTokenExpiredError';
  }
}
