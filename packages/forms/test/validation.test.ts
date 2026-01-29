import { describe, it, expect } from 'vitest';
import {
  validateSubmission,
  buildSchemaFromFields,
  checkHoneypot,
  computeSubmissionHash,
  applyDefaults,
  sanitizeSubmission,
} from '../src/validation';
import type { FormDefinition } from '../src/types';
import { sampleFields, sampleForm } from './fixtures';

// ─────────────────────────────────────────────────────────────────────────────
// Schema Building Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('buildSchemaFromFields', () => {
  it('should build schema with required fields', () => {
    const schema = buildSchemaFromFields(sampleFields);

    expect(schema.type).toBe('object');
    expect(schema.required).toContain('email');
    expect(schema.required).toContain('name');
    expect(schema.required).not.toContain('message'); // optional
  });

  it('should set email format', () => {
    const schema = buildSchemaFromFields(sampleFields);

    expect(schema.properties?.email?.format).toBe('email');
  });

  it('should set min/max length for text fields', () => {
    const schema = buildSchemaFromFields(sampleFields);

    expect(schema.properties?.name?.minLength).toBe(2);
    expect(schema.properties?.name?.maxLength).toBe(100);
  });

  it('should handle select field options', () => {
    const schema = buildSchemaFromFields(sampleFields);

    expect(schema.properties?.priority?.enum).toEqual(['low', 'medium', 'high']);
  });

  it('should set checkbox as boolean', () => {
    const schema = buildSchemaFromFields(sampleFields);

    expect(schema.properties?.subscribe?.type).toBe('boolean');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('validateSubmission', () => {
  const form: FormDefinition = {
    ...sampleForm,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it('should pass valid submission', () => {
    const errors = validateSubmission(form, {
      email: 'test@example.com',
      name: 'John Doe',
      message: 'Hello world',
      subscribe: true,
      priority: 'high',
    });

    expect(errors).toHaveLength(0);
  });

  it('should detect missing required fields', () => {
    const errors = validateSubmission(form, {
      email: 'test@example.com',
      // name is missing
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('name');
    expect(errors[0].keyword).toBe('required');
  });

  it('should detect invalid email format', () => {
    const errors = validateSubmission(form, {
      email: 'not-an-email',
      name: 'John Doe',
    });

    expect(errors.some((e) => e.field === 'email' && e.keyword === 'format')).toBe(true);
  });

  it('should detect string too short', () => {
    const errors = validateSubmission(form, {
      email: 'test@example.com',
      name: 'J', // minLength is 2
    });

    expect(errors.some((e) => e.field === 'name' && e.keyword === 'minLength')).toBe(true);
  });

  it('should detect invalid enum value', () => {
    const errors = validateSubmission(form, {
      email: 'test@example.com',
      name: 'John Doe',
      priority: 'invalid',
    });

    expect(errors.some((e) => e.field === 'priority' && e.keyword === 'enum')).toBe(true);
  });

  it('should reject additional properties', () => {
    const errors = validateSubmission(form, {
      email: 'test@example.com',
      name: 'John Doe',
      unknownField: 'value',
    });

    expect(errors.some((e) => e.keyword === 'additionalProperties')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Honeypot Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('checkHoneypot', () => {
  it('should return true when honeypot field is filled', () => {
    const isSpam = checkHoneypot({ _hp: 'bot filled this' }, '_hp');
    expect(isSpam).toBe(true);
  });

  it('should return false when honeypot field is empty', () => {
    const isSpam = checkHoneypot({ _hp: '' }, '_hp');
    expect(isSpam).toBe(false);
  });

  it('should return false when honeypot field is missing', () => {
    const isSpam = checkHoneypot({ email: 'test@example.com' }, '_hp');
    expect(isSpam).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Hash Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('computeSubmissionHash', () => {
  it('should produce same hash for same data', () => {
    const hash1 = computeSubmissionHash({ email: 'test@example.com', name: 'John' }, ['email', 'name']);
    const hash2 = computeSubmissionHash({ email: 'test@example.com', name: 'John' }, ['email', 'name']);

    expect(hash1).toBe(hash2);
  });

  it('should produce different hash for different data', () => {
    const hash1 = computeSubmissionHash({ email: 'test@example.com' }, ['email']);
    const hash2 = computeSubmissionHash({ email: 'other@example.com' }, ['email']);

    expect(hash1).not.toBe(hash2);
  });

  it('should only use specified fields', () => {
    const hash1 = computeSubmissionHash({ email: 'test@example.com', name: 'John' }, ['email']);
    const hash2 = computeSubmissionHash({ email: 'test@example.com', name: 'Jane' }, ['email']);

    expect(hash1).toBe(hash2); // name is not in hashFields
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Default Values Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('applyDefaults', () => {
  it('should apply default values for missing fields', () => {
    const result = applyDefaults(sampleFields, { email: 'test@example.com', name: 'John' });

    expect(result.subscribe).toBe(false); // default
    expect(result.priority).toBe('medium'); // default
  });

  it('should not override provided values', () => {
    const result = applyDefaults(sampleFields, {
      email: 'test@example.com',
      name: 'John',
      subscribe: true,
      priority: 'high',
    });

    expect(result.subscribe).toBe(true);
    expect(result.priority).toBe('high');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sanitization Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('sanitizeSubmission', () => {
  it('should remove honeypot field', () => {
    const result = sanitizeSubmission({ email: 'test@example.com', _hp: '' }, '_hp');

    expect(result.email).toBe('test@example.com');
    expect(result._hp).toBeUndefined();
  });

  it('should return data unchanged when no honeypot configured', () => {
    const data = { email: 'test@example.com' };
    const result = sanitizeSubmission(data, undefined);

    expect(result).toEqual(data);
  });
});
