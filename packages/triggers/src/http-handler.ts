import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { FlowRegistry, Engine } from '@flowmonkey/core';
import type {
  TriggerStore,
  TriggerResult,
  WakeSignaler,
  HttpTrigger,
  ValidationError,
} from './types';

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

// Cache compiled schemas
const schemaCache = new Map<string, ReturnType<typeof ajv.compile>>();

function getValidator(trigger: HttpTrigger) {
  let validate = schemaCache.get(trigger.id);
  if (!validate) {
    validate = ajv.compile(trigger.inputSchema);
    schemaCache.set(trigger.id, validate);
  }
  return validate;
}

export interface TriggerHandlerDeps {
  triggerStore: TriggerStore;
  flowRegistry: FlowRegistry;
  engine: Engine;
  signals?: WakeSignaler;
}

export interface RequestMeta {
  headers?: Record<string, string>;
  ip?: string;
}

/**
 * Handle an HTTP trigger invocation.
 * This is the core handler that can be used with any framework.
 */
export async function handleTrigger(
  deps: TriggerHandlerDeps,
  triggerId: string,
  body: unknown,
  meta: RequestMeta = {}
): Promise<TriggerResult> {
  const startTime = Date.now();

  // Load trigger
  const trigger = await deps.triggerStore.get(triggerId);

  if (!trigger) {
    return { status: 404, body: { error: 'Trigger not found' } };
  }

  if (!trigger.enabled) {
    await deps.triggerStore.logInvocation({
      triggerId,
      status: 'error',
      errorCode: 'TRIGGER_DISABLED',
      errorMessage: 'Trigger is disabled',
      requestBody: body,
      requestIp: meta.ip,
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
    });
    return { status: 403, body: { error: 'Trigger is disabled' } };
  }

  if (trigger.type !== 'http') {
    return { status: 400, body: { error: 'Not an HTTP trigger' } };
  }

  // Validate input
  const validate = getValidator(trigger);
  const valid = validate(body);

  if (!valid) {
    const errors: ValidationError[] = (validate.errors ?? []).map((e) => ({
      path: e.instancePath || (e.params as { missingProperty?: string })?.missingProperty || '',
      message: e.message ?? 'Invalid',
      keyword: e.keyword,
    }));

    await deps.triggerStore.logInvocation({
      triggerId,
      status: 'validation_failed',
      requestBody: body,
      requestIp: meta.ip,
      validationErrors: errors,
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
    });

    return { status: 400, body: { error: 'Validation failed', errors } };
  }

  // Check flow exists
  const flow = deps.flowRegistry.get(trigger.flowId);
  if (!flow) {
    await deps.triggerStore.logInvocation({
      triggerId,
      status: 'flow_not_found',
      errorCode: 'FLOW_NOT_FOUND',
      errorMessage: `Flow '${trigger.flowId}' not found`,
      requestBody: body,
      requestIp: meta.ip,
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
    });
    return { status: 500, body: { error: 'Flow not found' } };
  }

  // Create execution
  try {
    const context = { [trigger.contextKey]: body };

    const execution = await deps.engine.create(trigger.flowId, context);

    // Signal worker if available
    if (deps.signals) {
      await deps.signals.signal(execution.id);
    }

    await deps.triggerStore.logInvocation({
      triggerId,
      executionId: execution.id,
      status: 'success',
      requestBody: body,
      requestIp: meta.ip,
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
    });

    return { status: 201, body: { executionId: execution.id } };
  } catch (err) {
    await deps.triggerStore.logInvocation({
      triggerId,
      status: 'error',
      errorCode: 'EXECUTION_ERROR',
      errorMessage: err instanceof Error ? err.message : 'Unknown error',
      requestBody: body,
      requestIp: meta.ip,
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
    });
    return { status: 500, body: { error: 'Failed to create execution' } };
  }
}

/**
 * Clear schema cache (useful for testing).
 */
export function clearSchemaCache(): void {
  schemaCache.clear();
}
