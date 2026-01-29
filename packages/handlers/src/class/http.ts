/**
 * Class-based HTTP Handler using decorator system.
 *
 * Makes HTTP requests to external APIs.
 */

import {
  Handler,
  Input,
  StatelessHandler,
  Url,
  Min,
  Max,
} from '@flowmonkey/core';
import type { StepResult } from '@flowmonkey/core';

// ── Input Types ─────────────────────────────────────────────────────

export interface HttpInput {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Record<string, string>;
  body?: unknown;
  timeout: number;
  retries: number;
}

// ── Output Types ────────────────────────────────────────────────────

export interface HttpSuccessOutput {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  duration: number;
}

export interface HttpFailureOutput {
  code: string;
  message: string;
  status?: number;
  attempt?: number;
}

// ── Handler Class ───────────────────────────────────────────────────

@Handler({
  type: 'http',
  name: 'HTTP Request',
  description: 'Make HTTP requests to external APIs',
  category: 'external',
  defaultTimeout: 30000,
  retryable: true,
  visual: {
    icon: '🌐',
    color: '#0078d4',
    tags: ['network', 'api', 'rest'],
  },
  links: {
    docs: 'https://flowmonkey.dev/handlers/http',
  },
})
export class HttpHandler extends StatelessHandler<HttpInput, HttpSuccessOutput, HttpFailureOutput> {
  // ── Inputs ─────────────────────────────────────────────────────────

  @Input({ type: 'string', source: 'config', required: true, description: 'Target URL' })
  @Url()
  url!: string;

  @Input({ type: 'string', source: 'config', defaultValue: 'GET', description: 'HTTP method' })
  method!: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

  @Input({ type: 'object', source: 'config', description: 'Request headers' })
  headers?: Record<string, string>;

  @Input({ type: 'any', source: 'config', description: 'Request body (for POST/PUT/PATCH)' })
  body?: unknown;

  @Input({ type: 'number', source: 'config', defaultValue: 30000, description: 'Timeout in ms' })
  @Min(100)
  @Max(300000)
  timeout!: number;

  @Input({ type: 'number', source: 'config', defaultValue: 3, description: 'Max retry attempts' })
  @Min(0)
  @Max(10)
  retries!: number;

  // ── Outputs (declared for type inference) ─────────────────────────
  // Note: Output metadata is defined in handler metadata, not via decorators
  // on declare properties (TypeScript limitation)

  declare result: HttpSuccessOutput;
  declare error: HttpFailureOutput;

  // ── Execute ────────────────────────────────────────────────────────

  async execute(): Promise<StepResult> {
    const startTime = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        const response = await this.makeRequest();
        const duration = Date.now() - startTime;

        // Collect headers
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key] = value;
        });

        // Read body
        const body = await response.text();

        // Check status
        if (!response.ok) {
          return this.failure('HTTP_ERROR', `HTTP ${response.status} ${response.statusText}`, {
            code: 'HTTP_ERROR',
            message: response.statusText,
            status: response.status,
            attempt,
          });
        }

        return this.success({
          status: response.status,
          statusText: response.statusText,
          headers,
          body,
          duration,
        });
      } catch (error) {
        lastError = error as Error;

        // Don't retry if aborted
        if (this.signal?.aborted) {
          return this.failure('ABORTED', 'Request was cancelled', {
            code: 'ABORTED',
            message: 'Request was cancelled',
            attempt,
          });
        }

        // Don't retry on last attempt
        if (attempt < this.retries) {
          await this.backoff(attempt);
        }
      }
    }

    return this.failure('REQUEST_FAILED', lastError?.message ?? 'Unknown error', {
      code: 'REQUEST_FAILED',
      message: lastError?.message ?? 'Unknown error',
      attempt: this.retries,
    });
  }

  // ── Private Methods ────────────────────────────────────────────────

  private async makeRequest(): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.url, {
        method: this.method,
        headers: this.headers,
        body: this.body ? JSON.stringify(this.body) : undefined,
        signal: this.signal ?? controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async backoff(attempt: number): Promise<void> {
    // Exponential backoff: 100ms, 200ms, 400ms, etc.
    const delay = Math.min(100 * Math.pow(2, attempt - 1), 5000);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}
