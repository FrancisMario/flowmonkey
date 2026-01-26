import type { StepHandler, HandlerParams } from '@flowmonkey/core';

interface EmailReplyConfig {
  to: string;
  from: string;
  subject: string;
  body: string;
  responseOptions?: Array<{
    id: string;
    label: string;
  }>;
  waitDays?: number;
  emailProvider?: 'sendgrid' | 'mailgun' | 'ses';
  apiKey?: string;
}

export const emailReplyHandler: StepHandler = {
  type: 'email.reply',

  metadata: {
    type: 'email.reply',
    name: 'Email Reply (Wait)',
    description: 'Send email and wait for recipient response',
    category: 'external',
    stateful: false,
    retryable: false,

    visual: {
      icon: '📧',
      color: '#0078d4',
      tags: ['email', 'waiting', 'human-in-loop'],
    },

    configSchema: {
      type: 'object',
      required: ['to', 'from', 'subject', 'body'],
      properties: {
        to: { type: 'string', format: 'email', description: 'Recipient email' },
        from: { type: 'string', format: 'email', description: 'Sender email' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body (plaintext or HTML)' },
        responseOptions: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' } } },
          description: 'Response choices to show in email',
        },
        waitDays: { type: 'number', default: 7, description: 'Days to wait before expiration' },
        emailProvider: { type: 'string', enum: ['sendgrid', 'mailgun', 'ses'] },
        apiKey: { type: 'string', description: 'API key for email provider' },
      },
      additionalProperties: false,
    },

    examples: [
      {
        name: 'Simple approval email',
        config: {
          to: 'user@example.com',
          from: 'noreply@app.com',
          subject: 'Approval Needed',
          body: 'Please approve this request',
          waitDays: 3,
        },
      },
    ],
  },

  async execute(params: HandlerParams) {
    const config = params.step.config as unknown as EmailReplyConfig;

    if (!params.tokenManager) {
      return {
        outcome: 'failure' as const,
        error: { code: 'NO_TOKEN_MANAGER', message: 'Token manager not available' },
      };
    }

    const waitDays = config.waitDays || 7;
    const expiresInMs = waitDays * 24 * 60 * 60 * 1000;

    const token = await params.tokenManager.generate(params.execution.id, params.step.id, {
      expiresInMs,
      metadata: { email: config.to },
    });

    // Simulate email sending (would integrate with actual email service)
    console.log(`[email.reply] Would send email to ${config.to} with reply token ${token.token}`);

    return {
      outcome: 'wait' as const,
      waitReason: `Waiting for reply to email at ${config.to}`,
      resumeToken: token.token,
      wakeAt: Date.now() + expiresInMs,
      waitData: {
        emailTo: config.to,
        emailSubject: config.subject,
        expiresAt: Date.now() + expiresInMs,
      },
    };
  },
};
