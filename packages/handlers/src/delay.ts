import type { StepHandler, HandlerParams } from '@flowmonkey/core';

interface DelayConfig {
  ms?: number;
  seconds?: number;
  minutes?: number;
  hours?: number;
}

export const delayHandler: StepHandler = {
  type: 'delay',

  metadata: {
    type: 'delay',
    name: 'Delay',
    description: 'Wait for a specified duration',
    category: 'utility',
    stateful: false,
    retryable: true,

    visual: {
      icon: '⏱️',
      color: '#666',
      tags: ['time', 'wait', 'sleep'],
    },

    configSchema: {
      type: 'object',
      properties: {
        ms: { type: 'number', description: 'Milliseconds' },
        seconds: { type: 'number', description: 'Seconds' },
        minutes: { type: 'number', description: 'Minutes' },
        hours: { type: 'number', description: 'Hours' },
      },
      additionalProperties: false,
    },

    outputSchema: {
      type: 'object',
      properties: {
        delayedMs: { type: 'number' },
      },
    },

    examples: [
      {
        name: 'Delay 1 second',
        config: { ms: 1000 },
        expectedOutput: { delayedMs: 1000 },
      },
      {
        name: 'Delay 5 minutes',
        config: { minutes: 5 },
        expectedOutput: { delayedMs: 300000 },
      },
    ],
  },

  async execute(params: HandlerParams) {
    const config = params.step.config as unknown as DelayConfig;
    const ms = (config.ms || 0) + (config.seconds || 0) * 1000 + (config.minutes || 0) * 60 * 1000 + (config.hours || 0) * 60 * 60 * 1000;

    const startedAt = Date.now();

    await new Promise(resolve => setTimeout(resolve, ms));

    return {
      outcome: 'success' as const,
      output: {
        delayedMs: ms,
        actualMs: Date.now() - startedAt,
      },
    };
  },
};
