import type { StepHandler, HandlerParams } from '@flowmonkey/core';

/**
 * HTTP handler - make HTTP requests.
 */
export const httpHandler: StepHandler = {
  type: 'http',
  metadata: {
    type: 'http',
    name: 'HTTP Request',
    description: 'Make HTTP requests',
    category: 'external',
    stateful: false,
    configSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
  async execute(params: HandlerParams) {
    const input = params.input as {
      method?: string;
      url: string;
      headers?: Record<string, string>;
      body?: unknown;
      timeout?: number;
    };

    const method = input.method || 'GET';
    const timeout = input.timeout || 30000;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(input.url, {
        method,
        headers: input.headers || {},
        body: input.body ? JSON.stringify(input.body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return {
        outcome: 'success',
        output: {
          status: response.status,
          headers,
          body: await response.text(),
        },
      };
    } finally {
      clearTimeout(timeoutId);
    }
  },
};

/**
 * Delay handler - wait for a duration.
 */
export const delayHandler: StepHandler = {
  type: 'delay',
  metadata: {
    type: 'delay',
    name: 'Delay',
    description: 'Delay for a given duration',
    category: 'utility',
    stateful: false,
    configSchema: { type: 'object' },
  },
  async execute(params: HandlerParams) {
    const input = params.input as { ms: number };
    const delay = Number(input.ms) || 1000;

    return new Promise(resolve => {
      setTimeout(() => resolve({
        outcome: 'success',
        output: { delayed: delay },
      }), delay);
    });
  },
};

/**
 * LLM handler - call language model.
 */
export const llmHandler: StepHandler = {
  type: 'llm',
  metadata: {
    type: 'llm',
    name: 'LLM',
    description: 'Language model invocation (stub)',
    category: 'ai',
    stateful: false,
    configSchema: { type: 'object' },
  },
  async execute(params: HandlerParams) {
    const input = params.input as {
      model?: string;
      prompt: string;
      temperature?: number;
      maxTokens?: number;
      system?: string;
    };

    // Stub implementation - integrate with real LLM API
    // This would call OpenAI, Anthropic, etc.

    return {
      outcome: 'success',
      output: {
        model: input.model || 'gpt-4',
        prompt: input.prompt,
        result: '[LLM output would go here]',
      },
    };
  },
};

/**
 * Webhook handler - send webhook.
 */
export const webhookHandler: StepHandler = {
  type: 'webhook',
  metadata: {
    type: 'webhook',
    name: 'Webhook',
    description: 'Send webhook events',
    category: 'external',
    stateful: false,
    configSchema: { type: 'object' },
  },
  async execute(params: HandlerParams) {
    const input = params.input as {
      url: string;
      event: string;
      payload?: unknown;
      retries?: number;
    };

    const response = await fetch(input.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: input.event,
        executionId: params.execution.id,
        timestamp: Date.now(),
        payload: input.payload,
      }),
    });

    return {
      outcome: 'success',
      output: {
        status: response.status,
        webhookId: crypto.randomUUID(),
      },
    };
  },
};
