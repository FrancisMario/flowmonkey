/**
 * Class-based Transform Handler using decorator system.
 *
 * Transforms data using a JavaScript function.
 */

import {
  Handler,
  Input,
  StatelessHandler,
} from '@flowmonkey/core';
import type { StepResult } from '@flowmonkey/core';

// ── Output Types ────────────────────────────────────────────────────

export interface TransformSuccessOutput {
  result: unknown;
  transformedAt: number;
}

export interface TransformFailureOutput {
  code: string;
  message: string;
  input?: unknown;
}

// ── Handler Class ───────────────────────────────────────────────────

@Handler({
  type: 'transform',
  name: 'Transform',
  description: 'Transform data using a JavaScript expression or function',
  category: 'data',
  visual: {
    icon: '🔄',
    color: '#6b7280',
    tags: ['transform', 'map', 'filter', 'data'],
  },
})
export class TransformHandler extends StatelessHandler<unknown, TransformSuccessOutput, TransformFailureOutput> {
  // ── Inputs ─────────────────────────────────────────────────────────

  @Input({ type: 'any', source: 'previous', description: 'Input data to transform' })
  data?: unknown;

  @Input({ type: 'string', source: 'config', required: true, description: 'JavaScript expression or function body' })
  expression!: string;

  // ── Outputs (declared for type inference) ─────────────────────────

  declare result: TransformSuccessOutput;
  declare error: TransformFailureOutput;

  // ── Execute ────────────────────────────────────────────────────────

  async execute(): Promise<StepResult> {
    try {
      // Create a sandboxed function from the expression
      // The expression can reference `input` and `context`
      const fn = new Function('input', 'context', `return (${this.expression})`);
      
      const result = fn(this.data, this.context.context);

      return this.success({
        result,
        transformedAt: Date.now(),
      });
    } catch (error) {
      return this.failure('TRANSFORM_ERROR', (error as Error).message, {
        code: 'TRANSFORM_ERROR',
        message: (error as Error).message,
        input: this.data,
      });
    }
  }
}
