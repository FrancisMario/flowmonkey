/**
 * @flowmonkey/forms - Form Validation
 *
 * JSON Schema validation for form submissions with field-aware error messages.
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { FormDefinition, FormField, ValidationError, JSONSchema } from './types';

// Singleton AJV instance
let ajvInstance: Ajv | null = null;

/**
 * Get or create AJV instance.
 */
function getAjv(): Ajv {
  if (!ajvInstance) {
    ajvInstance = new Ajv({
      allErrors: true,
      verbose: true,
      coerceTypes: true,
    });
    addFormats(ajvInstance);
  }
  return ajvInstance;
}

/**
 * Build JSON Schema from form field definitions.
 */
export function buildSchemaFromFields(fields: FormField[]): JSONSchema {
  const properties: Record<string, JSONSchema> = {};
  const required: string[] = [];

  for (const field of fields) {
    const prop: JSONSchema = {};

    switch (field.type) {
      case 'text':
        prop.type = 'string';
        if (field.minLength !== undefined) prop.minLength = field.minLength;
        if (field.maxLength !== undefined) prop.maxLength = field.maxLength;
        if (field.pattern !== undefined) prop.pattern = field.pattern;
        break;

      case 'textarea':
        prop.type = 'string';
        if (field.minLength !== undefined) prop.minLength = field.minLength;
        if (field.maxLength !== undefined) prop.maxLength = field.maxLength;
        break;

      case 'email':
        prop.type = 'string';
        prop.format = 'email';
        break;

      case 'number':
        prop.type = 'number';
        if (field.min !== undefined) prop.minimum = field.min;
        if (field.max !== undefined) prop.maximum = field.max;
        break;

      case 'select':
        if (field.multiple) {
          prop.type = 'array';
          prop.items = { type: 'string', enum: field.options.map((o) => o.value) };
        } else {
          prop.type = 'string';
          prop.enum = field.options.map((o) => o.value);
        }
        break;

      case 'checkbox':
        prop.type = 'boolean';
        break;

      case 'radio':
        prop.type = 'string';
        prop.enum = field.options.map((o) => o.value);
        break;

      case 'date':
        prop.type = 'string';
        prop.format = 'date';
        break;

      case 'file':
        // File fields are validated separately (size, type)
        if (field.multiple) {
          prop.type = 'array';
          prop.items = { type: 'object' };
        } else {
          prop.type = 'object';
        }
        break;

      case 'hidden':
        // Hidden fields accept any value
        break;
    }

    // Apply custom validation if provided
    if (field.validation) {
      Object.assign(prop, field.validation);
    }

    properties[field.name] = prop;

    if (field.required) {
      required.push(field.name);
    }
  }

  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
    additionalProperties: false,
  };
}

/**
 * Get field label for error messages.
 */
function getFieldLabel(fields: FormField[], fieldName: string): string {
  const field = fields.find((f) => f.name === fieldName);
  return field?.label ?? fieldName;
}

/**
 * Convert AJV errors to user-friendly validation errors.
 */
function formatErrors(
  errors: NonNullable<Ajv['errors']>,
  fields: FormField[]
): ValidationError[] {
  return errors.map((err) => {
    // Extract field name from instance path
    const pathParts = err.instancePath.split('/').filter(Boolean);
    const fieldName = pathParts[0] ?? '';
    const label = getFieldLabel(fields, fieldName);

    let message: string;

    switch (err.keyword) {
      case 'required':
        message = `${getFieldLabel(fields, err.params.missingProperty)} is required`;
        return { field: err.params.missingProperty, message, keyword: 'required' };

      case 'type':
        message = `${label} must be a ${err.params.type}`;
        break;

      case 'format':
        if (err.params.format === 'email') {
          message = `${label} must be a valid email address`;
        } else if (err.params.format === 'date') {
          message = `${label} must be a valid date`;
        } else {
          message = `${label} has invalid format`;
        }
        break;

      case 'minimum':
        message = `${label} must be at least ${err.params.limit}`;
        break;

      case 'maximum':
        message = `${label} must be at most ${err.params.limit}`;
        break;

      case 'minLength':
        message = `${label} must be at least ${err.params.limit} characters`;
        break;

      case 'maxLength':
        message = `${label} must be at most ${err.params.limit} characters`;
        break;

      case 'pattern':
        message = `${label} has invalid format`;
        break;

      case 'enum':
        message = `${label} must be one of: ${err.params.allowedValues.join(', ')}`;
        break;

      case 'additionalProperties':
        message = `Unknown field: ${err.params.additionalProperty}`;
        return { field: err.params.additionalProperty, message, keyword: 'additionalProperties' };

      default:
        message = err.message ?? `${label} is invalid`;
    }

    return { field: fieldName, message, keyword: err.keyword };
  });
}

/**
 * Validate form submission data.
 */
export function validateSubmission(
  form: FormDefinition,
  data: Record<string, unknown>
): ValidationError[] {
  const ajv = getAjv();
  const schema = buildSchemaFromFields(form.fields);

  // Compile and validate
  const validate = ajv.compile(schema);
  const valid = validate(data);

  if (valid) {
    return [];
  }

  return formatErrors(validate.errors ?? [], form.fields);
}

/**
 * Check honeypot field.
 * Returns true if submission is likely spam.
 */
export function checkHoneypot(
  data: Record<string, unknown>,
  fieldName: string
): boolean {
  const value = data[fieldName];
  // Honeypot should be empty - if filled, it's likely a bot
  return value !== undefined && value !== '' && value !== null;
}

/**
 * Compute submission hash for deduplication.
 */
export function computeSubmissionHash(
  data: Record<string, unknown>,
  hashFields: string[]
): string {
  const values = hashFields
    .sort()
    .map((field) => {
      const value = data[field];
      return `${field}:${JSON.stringify(value)}`;
    })
    .join('|');

  // Simple hash function (for production, use crypto)
  let hash = 0;
  for (let i = 0; i < values.length; i++) {
    const char = values.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `h${Math.abs(hash).toString(36)}`;
}

/**
 * Apply default values to submission data.
 */
export function applyDefaults(
  fields: FormField[],
  data: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...data };

  for (const field of fields) {
    if (result[field.name] === undefined && field.defaultValue !== undefined) {
      result[field.name] = field.defaultValue;
    }
  }

  return result;
}

/**
 * Remove honeypot field from submission data.
 */
export function sanitizeSubmission(
  data: Record<string, unknown>,
  honeypotField?: string
): Record<string, unknown> {
  if (!honeypotField) return data;

  const result = { ...data };
  delete result[honeypotField];
  return result;
}
