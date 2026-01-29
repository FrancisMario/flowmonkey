/**
 * Class-based Email Reply Handler using decorator system.
 *
 * Stateful handler that waits for an email reply before continuing.
 */

import {
  Handler,
  Input,
  Email,
  MinLength,
  StatefulHandler,
} from '@flowmonkey/core';
import type { StepResult } from '@flowmonkey/core';

// ── Checkpoint Type ─────────────────────────────────────────────────

export interface EmailReplyCheckpoint {
  emailId: string;
  sentAt: number;
  pollCount: number;
  lastPollAt?: number;
}

// ── Output Types ────────────────────────────────────────────────────

export interface EmailReplySuccessOutput {
  emailId: string;
  replyId: string;
  replyFrom: string;
  replySubject: string;
  replyBody: string;
  receivedAt: number;
}

export interface EmailReplyFailureOutput {
  code: string;
  message: string;
  emailId?: string;
}

// ── Handler Class ───────────────────────────────────────────────────

@Handler({
  type: 'email-reply',
  name: 'Wait for Email Reply',
  description: 'Send an email and wait for a reply before continuing',
  category: 'external',
  stateful: true,
  visual: {
    icon: '📧',
    color: '#3b82f6',
    tags: ['email', 'reply', 'wait', 'communication'],
  },
})
export class EmailReplyHandler extends StatefulHandler<
  void, 
  EmailReplySuccessOutput, 
  EmailReplyFailureOutput,
  EmailReplyCheckpoint
> {
  // ── Inputs ─────────────────────────────────────────────────────────

  @Input({ type: 'string', source: 'config', required: true, description: 'Recipient email address' })
  @Email()
  to!: string;

  @Input({ type: 'string', source: 'config', required: true, description: 'Email subject' })
  @MinLength(1, 'Subject cannot be empty')
  subject!: string;

  @Input({ type: 'string', source: 'config', required: true, description: 'Email body' })
  @MinLength(1, 'Body cannot be empty')
  body!: string;

  @Input({ type: 'string', source: 'config', description: 'Reply-to email address' })
  @Email()
  replyTo?: string;

  @Input({ type: 'number', source: 'config', description: 'Timeout in milliseconds (default: 7 days)' })
  timeoutMs?: number;

  // ── Outputs (declared for type inference) ─────────────────────────

  declare result: EmailReplySuccessOutput;
  declare error: EmailReplyFailureOutput;

  // ── Execute (Stateful) ─────────────────────────────────────────────

  async execute(): Promise<StepResult> {
    const checkpoint = await this.getCheckpoint();

    // If we have a checkpoint, we're resuming - check for reply
    if (checkpoint) {
      return this.checkForReply(checkpoint);
    }

    // First execution - send the email
    return this.sendEmail();
  }

  private async sendEmail(): Promise<StepResult> {
    // In a real implementation, this would use an email service
    // For now, we simulate sending and create a checkpoint
    const emailId = `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const checkpointData: EmailReplyCheckpoint = {
      emailId,
      sentAt: Date.now(),
      pollCount: 0,
    };

    await this.checkpoint(checkpointData);

    // Report progress (50% - email sent, waiting for reply)
    await this.reportProgress(50, `Email sent to ${this.to}, waiting for reply`);

    // Return wait result - job runner will poll this handler
    return {
      outcome: 'wait',
      waitReason: 'Waiting for email reply',
      waitData: {
        emailId,
        sentAt: checkpointData.sentAt,
      },
    };
  }

  private async checkForReply(checkpointData: EmailReplyCheckpoint): Promise<StepResult> {
    // Update checkpoint with poll info
    checkpointData.pollCount++;
    checkpointData.lastPollAt = Date.now();
    await this.checkpoint(checkpointData);

    // Check for timeout
    const timeout = this.timeoutMs ?? 7 * 24 * 60 * 60 * 1000; // 7 days default
    if (Date.now() - checkpointData.sentAt > timeout) {
      return this.failure('TIMEOUT', `No reply received within ${timeout}ms`, {
        code: 'TIMEOUT',
        message: `No reply received within ${timeout}ms`,
        emailId: checkpointData.emailId,
      });
    }

    // In a real implementation, this would check an email inbox
    // For now, simulate no reply yet
    await this.reportProgress(50, `Poll ${checkpointData.pollCount}: Still waiting for reply to ${checkpointData.emailId}`);

    // Return wait result - still waiting for reply
    return {
      outcome: 'wait',
      waitReason: 'Still waiting for email reply',
      waitData: {
        emailId: checkpointData.emailId,
        pollCount: checkpointData.pollCount,
      },
    };
  }
}
