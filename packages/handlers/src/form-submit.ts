import type { StepHandler, HandlerParams } from '@flowmonkey/core';

interface FormSubmitConfig {
  formId: string;
  fields: Array<{
    id: string;
    label: string;
    type: 'text' | 'email' | 'number' | 'textarea' | 'select';
    required?: boolean;
    options?: string[];
  }>;
  submitText?: string;
  expiresInDays?: number;
}

export const formSubmitHandler: StepHandler = {
  type: 'form.submit',

  metadata: {
    type: 'form.submit',
    name: 'Form Submission (Wait)',
    description: 'Generate form and wait for submission',
    category: 'external',
    stateful: false,
    retryable: false,

    visual: {
      icon: '📝',
      color: '#107c10',
      tags: ['form', 'input', 'waiting'],
    },

    configSchema: {
      type: 'object',
      required: ['formId', 'fields'],
      properties: {
        formId: { type: 'string', description: 'Unique form identifier' },
        fields: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'label', 'type'],
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              type: { type: 'string', enum: ['text', 'email', 'number', 'textarea', 'select'] },
              required: { type: 'boolean' },
              options: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        submitText: { type: 'string', default: 'Submit' },
        expiresInDays: { type: 'number', default: 30 },
      },
      additionalProperties: false,
    },

    examples: [
      {
        name: 'User feedback form',
        config: {
          formId: 'feedback_123',
          fields: [
            { id: 'rating', label: 'Rating', type: 'number', required: true },
            { id: 'comment', label: 'Comments', type: 'textarea' },
          ],
          expiresInDays: 7,
        },
      },
    ],
  },

  async execute(params: HandlerParams) {
    const config = params.step.config as unknown as FormSubmitConfig;

    if (!params.tokenManager) {
      return {
        outcome: 'failure' as const,
        error: { code: 'NO_TOKEN_MANAGER', message: 'Token manager not available' },
      };
    }

    const expiresInDays = config.expiresInDays || 30;
    const expiresInMs = expiresInDays * 24 * 60 * 60 * 1000;

    const token = await params.tokenManager.generate(params.execution.id, params.step.id, {
      expiresInMs,
      metadata: { formId: config.formId },
    });

    // Generate form URL
    const formUrl = `https://forms.app/f/${token.token}`;

    console.log(`[form.submit] Generated form at ${formUrl}`);

    return {
      outcome: 'wait' as const,
      waitReason: `Waiting for form submission`,
      resumeToken: token.token,
      wakeAt: Date.now() + expiresInMs,
      waitData: {
        formUrl,
        formId: config.formId,
        expiresAt: Date.now() + expiresInMs,
      },
    };
  },
};
