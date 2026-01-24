import type { Engine } from '@flowmonkey/core';

/**
 * Trigger interface - listens for external events and starts flows.
 */
export interface Trigger {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * HTTP trigger - receive webhook payloads and start flows.
 */
export class HttpTrigger implements Trigger {
  readonly name = 'http';

  constructor(
    private engine: Engine,
    private port = 3000,
    private flowId = 'default'
  ) {}

  async start(): Promise<void> {
    // Stub: Would set up HTTP server here
    // In real implementation, use Express, Fastify, or similar
    console.log(`[HttpTrigger] Listening on port ${this.port}`);
  }

  async stop(): Promise<void> {
    // Close server
    console.log(`[HttpTrigger] Stopped`);
  }

  /**
   * Handle incoming webhook.
   */
  async handleWebhook(payload: any): Promise<string> {
    // Start flow execution with payload as context
    const execution = await this.engine.create(this.flowId, payload);
    return execution.id;
  }
}

/**
 * Cron trigger - run flow on schedule.
 */
export class CronTrigger implements Trigger {
  readonly name = 'cron';
  private interval: any;

  constructor(
    private engine: Engine,
    private schedule: string, // Cron expression: "0 * * * *" = hourly
    private flowId = 'default'
  ) {}

  async start(): Promise<void> {
    // Stub: Would use cron library (e.g., node-cron)
    console.log(`[CronTrigger] Scheduled: ${this.schedule}`);

    // This would parse cron and set up periodic triggers
    // For now, just log the intent
  }

  async stop(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
    }
    console.log(`[CronTrigger] Stopped`);
  }

  /**
   * Internal: Fire the trigger manually.
   */
  async fire(): Promise<string> {
    const execution = await this.engine.create(this.flowId, { triggeredAt: Date.now() });
    return execution.id;
  }
}

/**
 * Event trigger - listen for events and start flows.
 */
export class EventTrigger implements Trigger {
  readonly name = 'event';
  private listeners = new Map<string, Set<string>>();

  constructor(private engine: Engine) {}

  async start(): Promise<void> {
    console.log(`[EventTrigger] Started`);
  }

  async stop(): Promise<void> {
    this.listeners.clear();
    console.log(`[EventTrigger] Stopped`);
  }

  /**
   * Subscribe: flow is started when event is emitted.
   */
  subscribe(eventName: string, flowId: string): void {
    let flows = this.listeners.get(eventName);
    if (!flows) {
      flows = new Set();
      this.listeners.set(eventName, flows);
    }
    flows.add(flowId);
  }

  /**
   * Emit event (could come from external service).
   */
  async emit(eventName: string, payload: any): Promise<void> {
    const flows = this.listeners.get(eventName);
    if (!flows) return;

    for (const flowId of flows) {
      await this.engine.create(flowId, { event: eventName, ...payload });
    }
  }
}
