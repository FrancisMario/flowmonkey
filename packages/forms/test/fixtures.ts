import { vi } from 'vitest';
import type { FlowRegistry, Engine } from '@flowmonkey/core';
import type { FormDefinition, FormField } from '../src/types';

// ─────────────────────────────────────────────────────────────────────────────
// Mock Engine
// ─────────────────────────────────────────────────────────────────────────────

export const mockFlowRegistry = {
  get: vi.fn(),
  has: vi.fn(),
  register: vi.fn(),
  flowIds: vi.fn(),
  versions: vi.fn(),
  validate: vi.fn(),
} as unknown as FlowRegistry & { get: ReturnType<typeof vi.fn> };

export const mockEngine = {
  create: vi.fn(),
  tick: vi.fn(),
  run: vi.fn(),
  cancel: vi.fn(),
  get: vi.fn(),
  flows: mockFlowRegistry,
} as unknown as Engine & { create: ReturnType<typeof vi.fn> };

export const mockFlow = {
  id: 'test-flow',
  version: '1.0.0',
  initialStepId: 'start',
  steps: {},
};

// ─────────────────────────────────────────────────────────────────────────────
// Sample Form Fields
// ─────────────────────────────────────────────────────────────────────────────

export const sampleFields: FormField[] = [
  {
    name: 'email',
    type: 'email',
    label: 'Email Address',
    required: true,
    placeholder: 'you@example.com',
  },
  {
    name: 'name',
    type: 'text',
    label: 'Full Name',
    required: true,
    minLength: 2,
    maxLength: 100,
  },
  {
    name: 'message',
    type: 'textarea',
    label: 'Message',
    required: false,
    maxLength: 1000,
    rows: 5,
  },
  {
    name: 'subscribe',
    type: 'checkbox',
    label: 'Subscribe to newsletter',
    defaultValue: false,
  },
  {
    name: 'priority',
    type: 'select',
    label: 'Priority',
    options: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ],
    defaultValue: 'medium',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Sample Forms
// ─────────────────────────────────────────────────────────────────────────────

export const sampleForm: Omit<FormDefinition, 'createdAt' | 'updatedAt'> = {
  id: 'contact-form',
  name: 'Contact Form',
  description: 'A simple contact form',
  flowId: 'contact-workflow',
  contextKey: 'formData',
  fields: sampleFields,
  enabled: true,
  submitLabel: 'Send Message',
  successMessage: 'Thank you for your message!',
};

export const formWithSecurity: Omit<FormDefinition, 'createdAt' | 'updatedAt'> = {
  id: 'secure-form',
  name: 'Secure Form',
  flowId: 'secure-workflow',
  contextKey: 'data',
  fields: [
    { name: 'email', type: 'email', label: 'Email', required: true },
    { name: 'comment', type: 'textarea', label: 'Comment', required: true },
  ],
  security: {
    captcha: {
      provider: 'recaptcha-v3',
      siteKey: 'test-site-key',
      secretKey: 'test-secret-key',
      minScore: 0.5,
    },
    rateLimit: {
      maxSubmissions: 5,
      windowSeconds: 3600,
      keyBy: 'ip',
    },
    honeypot: {
      fieldName: '_hp_field',
    },
    deduplication: {
      enabled: true,
      hashFields: ['email', 'comment'],
      windowSeconds: 300,
    },
  },
  enabled: true,
};

export const formWithTenant: Omit<FormDefinition, 'createdAt' | 'updatedAt'> = {
  id: 'tenant-form',
  name: 'Tenant Form',
  tenantId: 'tenant-123',
  flowId: 'tenant-workflow',
  contextKey: 'data',
  fields: [{ name: 'data', type: 'text', label: 'Data', required: true }],
  enabled: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// Sample Submission Data
// ─────────────────────────────────────────────────────────────────────────────

export const validSubmissionData = {
  email: 'test@example.com',
  name: 'John Doe',
  message: 'Hello, this is a test message.',
  subscribe: true,
  priority: 'high',
};

export const invalidSubmissionData = {
  email: 'not-an-email',
  name: 'J', // Too short
  priority: 'invalid-option',
};

export const submissionMeta = {
  ip: '127.0.0.1',
  userAgent: 'Mozilla/5.0 Test Agent',
  referer: 'https://example.com/contact',
};

// ─────────────────────────────────────────────────────────────────────────────
// Reset Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function resetMocks() {
  vi.clearAllMocks();
  mockFlowRegistry.get.mockReturnValue(mockFlow);
  mockEngine.create.mockResolvedValue({
    execution: {
      id: 'exec_abc123',
      flowId: 'test-flow',
      status: 'pending',
    },
    created: true,
    idempotencyHit: false,
  });
}
