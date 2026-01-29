/**
 * Class-based Form Submit Handler using decorator system.
 *
 * Stateful handler that waits for a form submission before continuing.
 */

import {
  Handler,
  Input,
  MinLength,
  StatefulHandler,
} from '@flowmonkey/core';
import type { StepResult } from '@flowmonkey/core';

// ── Checkpoint Type ─────────────────────────────────────────────────

export interface FormSubmitCheckpoint {
  formId: string;
  createdAt: number;
  formUrl: string;
  pollCount: number;
  lastPollAt?: number;
}

// ── Output Types ────────────────────────────────────────────────────

export interface FormField {
  name: string;
  type: 'text' | 'email' | 'number' | 'textarea' | 'select' | 'checkbox' | 'radio';
  label?: string;
  required?: boolean;
  options?: string[];
  defaultValue?: unknown;
}

export interface FormSubmitSuccessOutput {
  formId: string;
  submissionId: string;
  data: Record<string, unknown>;
  submittedAt: number;
  submitterIp?: string;
}

export interface FormSubmitFailureOutput {
  code: string;
  message: string;
  formId?: string;
}

// ── Handler Class ───────────────────────────────────────────────────

@Handler({
  type: 'form-submit',
  name: 'Wait for Form Submission',
  description: 'Create a form and wait for someone to submit it',
  category: 'external',
  stateful: true,
  visual: {
    icon: '📋',
    color: '#10b981',
    tags: ['form', 'submit', 'wait', 'input', 'user'],
  },
})
export class FormSubmitHandler extends StatefulHandler<
  void,
  FormSubmitSuccessOutput,
  FormSubmitFailureOutput,
  FormSubmitCheckpoint
> {
  // ── Inputs ─────────────────────────────────────────────────────────

  @Input({ type: 'string', source: 'config', required: true, description: 'Form title' })
  @MinLength(1, 'Title cannot be empty')
  title!: string;

  @Input({ type: 'string', source: 'config', description: 'Form description' })
  description?: string;

  @Input({ type: 'array', source: 'config', required: true, description: 'Form fields configuration' })
  fields!: FormField[];

  @Input({ type: 'string', source: 'config', description: 'Submit button text' })
  submitText?: string;

  @Input({ type: 'number', source: 'config', description: 'Timeout in milliseconds (default: 7 days)' })
  timeoutMs?: number;

  @Input({ type: 'string', source: 'config', description: 'Redirect URL after submission' })
  redirectUrl?: string;

  // ── Outputs (declared for type inference) ─────────────────────────

  declare result: FormSubmitSuccessOutput;
  declare error: FormSubmitFailureOutput;

  // ── Execute (Stateful) ─────────────────────────────────────────────

  async execute(): Promise<StepResult> {
    const checkpoint = await this.getCheckpoint();

    // If we have a checkpoint, we're resuming - check for submission
    if (checkpoint) {
      return this.checkForSubmission(checkpoint);
    }

    // First execution - create the form
    return this.createForm();
  }

  private async createForm(): Promise<StepResult> {
    // In a real implementation, this would create a form in a database
    // and return a URL for users to access
    const formId = `form_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const formUrl = `/forms/${formId}`;

    const checkpointData: FormSubmitCheckpoint = {
      formId,
      createdAt: Date.now(),
      formUrl,
      pollCount: 0,
    };

    await this.checkpoint(checkpointData);

    // Report progress (50% - form created, waiting for submission)
    await this.reportProgress(50, `Form created: ${this.title}`);

    // Return wait result - job runner will poll this handler
    return {
      outcome: 'wait',
      waitReason: 'Waiting for form submission',
      waitData: {
        formId,
        formUrl,
        title: this.title,
        fieldCount: this.fields.length,
      },
    };
  }

  private async checkForSubmission(checkpointData: FormSubmitCheckpoint): Promise<StepResult> {
    // Update checkpoint with poll info
    checkpointData.pollCount++;
    checkpointData.lastPollAt = Date.now();
    await this.checkpoint(checkpointData);

    // Check for timeout
    const timeout = this.timeoutMs ?? 7 * 24 * 60 * 60 * 1000; // 7 days default
    if (Date.now() - checkpointData.createdAt > timeout) {
      return this.failure('TIMEOUT', `No submission received within ${timeout}ms`, {
        code: 'TIMEOUT',
        message: `No submission received within ${timeout}ms`,
        formId: checkpointData.formId,
      });
    }

    // In a real implementation, this would check a database for submissions
    // For now, simulate no submission yet
    await this.reportProgress(50, `Poll ${checkpointData.pollCount}: Still waiting for submission on ${checkpointData.formId}`);

    // Return wait result - still waiting for submission
    return {
      outcome: 'wait',
      waitReason: 'Still waiting for form submission',
      waitData: {
        formId: checkpointData.formId,
        formUrl: checkpointData.formUrl,
        pollCount: checkpointData.pollCount,
      },
    };
  }
}
