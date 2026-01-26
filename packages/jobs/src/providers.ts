import type { StepHandler, HandlerParams } from '@flowmonkey/core';

export interface JobProvider {
  /** Name of this provider */
  readonly name: string;

  /** Create a handler for stateful jobs */
  createHandler(): StepHandler;
}

/**
 * In-process job queue provider.
 * Suitable for single-threaded testing. In production use JobScheduler with persistence.
 */
export class InProcessJobProvider implements JobProvider {
  readonly name = 'in-process';
  private handlers = new Map<string, StepHandler>();

  /**
   * Register a handler by name.
   */
  registerHandler(name: string, handler: StepHandler): void {
    this.handlers.set(name, handler);
  }

  createHandler(): StepHandler {
    return {
      type: 'job',
      metadata: { type: 'job', name: 'Job', configSchema: { type: 'object' } },
      stateful: true,
      async execute(params: HandlerParams) {
        const { job } = params.input as {
          job: string;
          maxAttempts?: number;
        };

        // In production, this would interact with JobStore
        return { outcome: 'success', output: { jobId: job, status: 'pending' } };
      },
    };
  }
}

/**
 * External job server provider.
 * Send jobs to a remote service via HTTP/gRPC.
 */
export class ExternalJobProvider implements JobProvider {
  readonly name = 'external';

  constructor(private readonly endpoint: string) {}

  createHandler(): StepHandler {
    const endpoint = this.endpoint;
    return {
      type: 'external-job',
      metadata: { type: 'external-job', name: 'External Job', configSchema: { type: 'object' } },
      stateful: true,
      async execute(params: HandlerParams) {
        const { handler, input } = params.input as { handler: string; input: unknown };

        const response = await fetch(`${endpoint}/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            executionId: params.execution.id,
            stepId: params.step.id,
            handler,
            input,
          }),
        });

        if (!response.ok) {
          throw new Error(`Job server error: ${response.statusText}`);
        }

        return {
          outcome: 'success',
          output: await response.json(),
        };
      },
    };
  }
}
