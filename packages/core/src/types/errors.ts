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

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
  readonly severity: 'error' | 'warning';
}
