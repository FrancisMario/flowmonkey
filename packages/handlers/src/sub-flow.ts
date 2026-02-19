/**
 * Sub-flow Handler
 *
 * Spawns a child execution. Optionally runs it to completion and returns
 * the child's final context as output.
 *
 * Because handlers don't have direct access to the engine, this is a
 * **factory function** — you pass the engine in and get a StepHandler back.
 *
 * ```typescript
 * import { createSubFlowHandler } from '@flowmonkey/handlers';
 *
 * const subFlowHandler = createSubFlowHandler(engine);
 * handlerRegistry.register(subFlowHandler);
 *
 * // In a flow:
 * step: {
 *   type: 'sub-flow',
 *   config: {
 *     flowId: 'child-flow',         // required
 *     waitForCompletion: true,       // default: true
 *   },
 *   input: { type: 'full' },        // passed as child context
 *   outputKey: 'childResult',
 *   transitions: { onSuccess: 'next', onFailure: 'handle-error' },
 * }
 * ```
 */

import type { StepHandler, HandlerParams } from '@flowmonkey/core';

export interface SubFlowConfig {
  /** Flow ID to spawn as child */
  flowId: string;
  /** Whether to wait for the child to finish (default: true) */
  waitForCompletion?: boolean;
  /** Custom child execution metadata */
  metadata?: Record<string, unknown>;
  /** Tenant ID override (defaults to parent's tenantId) */
  tenantId?: string;
}

/**
 * Minimal engine interface needed by the sub-flow handler.
 * Matches the Engine class, but allows test doubles.
 */
export interface SubFlowEngine {
  create(
    flowId: string,
    context?: Record<string, unknown>,
    options?: {
      parentExecutionId?: string;
      tenantId?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<{ execution: { id: string; status: string; context: Record<string, unknown> } }>;

  run(
    executionId: string,
    options?: { simulateTime?: boolean },
  ): Promise<{ done: boolean; status: string; error?: { code: string; message: string } }>;

  get(executionId: string): Promise<{ id: string; status: string; context: Record<string, unknown> } | null>;
}

/**
 * Create a sub-flow handler bound to an engine instance.
 */
export function createSubFlowHandler(engine: SubFlowEngine): StepHandler {
  return {
    type: 'sub-flow',
    metadata: {
      type: 'sub-flow',
      name: 'Sub-flow',
      description: 'Spawn a child execution for a different flow',
      category: 'control',
      stateful: false,
      configSchema: {
        type: 'object',
        properties: {
          flowId: { type: 'string' },
          waitForCompletion: { type: 'boolean', default: true },
          metadata: { type: 'object' },
          tenantId: { type: 'string' },
        },
        required: ['flowId'],
      },
    },
    async execute(params: HandlerParams) {
      const config = params.step.config as unknown as SubFlowConfig;

      if (!config.flowId) {
        return {
          outcome: 'failure' as const,
          error: { code: 'MISSING_FLOW_ID', message: 'Sub-flow config must include flowId' },
        };
      }

      const childContext = (params.input ?? {}) as Record<string, unknown>;
      const waitForCompletion = config.waitForCompletion !== false;

      try {
        // Create child execution linked to parent
        const { execution: child } = await engine.create(config.flowId, childContext, {
          parentExecutionId: params.execution.id,
          tenantId: config.tenantId ?? params.execution.tenantId,
          metadata: config.metadata,
        });

        if (!waitForCompletion) {
          // Fire-and-forget — return child ID immediately
          return {
            outcome: 'success' as const,
            output: {
              childExecutionId: child.id,
              flowId: config.flowId,
              mode: 'fire-and-forget',
            },
          };
        }

        // Run child to completion
        const result = await engine.run(child.id, { simulateTime: false });

        if (result.status === 'completed') {
          // Fetch final child state
          const final = await engine.get(child.id);
          return {
            outcome: 'success' as const,
            output: {
              childExecutionId: child.id,
              flowId: config.flowId,
              status: 'completed',
              context: final?.context ?? {},
            },
          };
        }

        // Child failed
        return {
          outcome: 'failure' as const,
          error: {
            code: 'CHILD_FAILED',
            message: `Child execution ${child.id} ended with status: ${result.status}`,
            details: result.error,
          },
        };
      } catch (err) {
        return {
          outcome: 'failure' as const,
          error: {
            code: 'SUB_FLOW_ERROR',
            message: err instanceof Error ? err.message : 'Sub-flow execution failed',
          },
        };
      }
    },
  };
}
