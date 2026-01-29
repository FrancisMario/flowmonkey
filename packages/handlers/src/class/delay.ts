/**
 * Class-based Delay Handler using decorator system.
 *
 * Pauses execution for a specified duration.
 */

import {
  Handler,
  Input,
  Min,
  Max,
  StatelessHandler,
} from '@flowmonkey/core';
import type { StepResult } from '@flowmonkey/core';

// ── Output Types ────────────────────────────────────────────────────

export interface DelaySuccessOutput {
  delayMs: number;
  startedAt: number;
  completedAt: number;
}

// ── Handler Class ───────────────────────────────────────────────────

@Handler({
  type: 'delay',
  name: 'Delay',
  description: 'Pause execution for a specified duration',
  category: 'control',
  visual: {
    icon: '⏱️',
    color: '#8b5cf6',
    tags: ['delay', 'wait', 'pause', 'timer'],
  },
})
export class DelayHandler extends StatelessHandler<void, DelaySuccessOutput, never> {
  // ── Inputs ─────────────────────────────────────────────────────────

  @Input({ type: 'number', source: 'config', required: true, description: 'Delay duration in milliseconds' })
  @Min(0, 'Delay must be non-negative')
  @Max(86400000, 'Delay cannot exceed 24 hours') // 24 hours in ms
  delayMs!: number;

  // ── Outputs (declared for type inference) ─────────────────────────

  declare result: DelaySuccessOutput;

  // ── Execute ────────────────────────────────────────────────────────

  async execute(): Promise<StepResult> {
    const startedAt = Date.now();

    // Use a promise-based delay
    await new Promise<void>((resolve) => setTimeout(resolve, this.delayMs));

    const completedAt = Date.now();

    return this.success({
      delayMs: this.delayMs,
      startedAt,
      completedAt,
    });
  }
}
