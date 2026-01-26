import type { StepHandler, HandlerParams } from '@flowmonkey/core';

interface HttpConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
  retries?: number;
  validateStatus?: (status: number) => boolean;
}

interface HttpOutput {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  duration: number;
}

export const httpHandler: StepHandler = {
  type: 'http',

  metadata: {
    type: 'http',
    name: 'HTTP Request',
    description: 'Make HTTP requests to external APIs',
    category: 'external',
    stateful: false,
    defaultTimeout: 30000,
    retryable: true,

    visual: {
      icon: '🌐',
      color: '#0078d4',
      tags: ['network', 'api', 'rest'],
    },

    configSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string', description: 'Target URL' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'], default: 'GET' },
        headers: { type: 'object', additionalProperties: { type: 'string' } },
        body: { description: 'Request body (stringified if not string)' },
        timeout: { type: 'number', default: 30000, description: 'Timeout in milliseconds' },
        retries: { type: 'number', default: 3 },
        validateStatus: { type: 'object', description: 'Custom status validator' },
      },
      additionalProperties: false,
    },

    outputSchema: {
      type: 'object',
      properties: {
        status: { type: 'number' },
        statusText: { type: 'string' },
        headers: { type: 'object' },
        body: { type: 'string' },
        duration: { type: 'number' },
      },
    },

    examples: [
      {
        name: 'Simple GET',
        config: { url: 'https://api.example.com/users' },
        expectedOutput: { status: 200, body: '[...]', duration: 150 },
      },
      {
        name: 'POST with body',
        config: { url: 'https://api.example.com/users', method: 'POST', body: { name: 'John' } },
        expectedOutput: { status: 201, body: '{"id":"1"}', duration: 250 },
      },
    ],
  },

  async execute(params: HandlerParams) {
    const config = params.step.config as unknown as HttpConfig;
    const startTime = Date.now();

    const controller = new AbortController();
    const timeout = config.timeout ?? 30000;
    const timeoutHandle = setTimeout(() => controller.abort(), timeout);

    try {
      const method = config.method || 'GET';
      const body = config.body ? (typeof config.body === 'string' ? config.body : JSON.stringify(config.body)) : undefined;

      const response = await fetch(config.url, {
        method,
        headers: config.headers || {},
        body,
        signal: controller.signal,
      });

      const responseText = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        outcome: 'success' as const,
        output: {
          status: response.status,
          statusText: response.statusText,
          headers,
          body: responseText,
          duration: Date.now() - startTime,
        } as HttpOutput,
      };
    } catch (error) {
      return {
        outcome: 'failure' as const,
        error: {
          code: 'HTTP_ERROR',
          message: error instanceof Error ? error.message : 'HTTP request failed',
          retryable: true,
        },
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  },
};
