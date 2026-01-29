/**
 * Validation decorators for input properties.
 */

import { addValidationRule } from './metadata';

/**
 * Validation rule types.
 */
export type ValidationRule =
  | { type: 'min'; value: number; message?: string }
  | { type: 'max'; value: number; message?: string }
  | { type: 'minLength'; value: number; message?: string }
  | { type: 'maxLength'; value: number; message?: string }
  | { type: 'pattern'; value: RegExp; message?: string }
  | { type: 'email'; message?: string }
  | { type: 'url'; message?: string }
  | { type: 'custom'; validate: (value: unknown) => boolean | string; message?: string };

/**
 * @Min decorator - validates minimum numeric value.
 *
 * @example
 * ```typescript
 * @Input({ type: 'number', source: 'config' })
 * @Min(0)
 * retryCount!: number;
 * ```
 */
export function Min(value: number, message?: string): PropertyDecorator {
  return function (target: Object, propertyKey: string | symbol) {
    if (typeof propertyKey === 'symbol') return;
    addValidationRule(target.constructor.prototype, propertyKey, {
      type: 'min',
      value,
      message: message ?? `Value must be at least ${value}`,
    });
  };
}

/**
 * @Max decorator - validates maximum numeric value.
 *
 * @example
 * ```typescript
 * @Input({ type: 'number', source: 'config' })
 * @Max(100)
 * percentage!: number;
 * ```
 */
export function Max(value: number, message?: string): PropertyDecorator {
  return function (target: Object, propertyKey: string | symbol) {
    if (typeof propertyKey === 'symbol') return;
    addValidationRule(target.constructor.prototype, propertyKey, {
      type: 'max',
      value,
      message: message ?? `Value must be at most ${value}`,
    });
  };
}

/**
 * @MinLength decorator - validates minimum string/array length.
 *
 * @example
 * ```typescript
 * @Input({ type: 'string', source: 'config' })
 * @MinLength(1)
 * name!: string;
 * ```
 */
export function MinLength(value: number, message?: string): PropertyDecorator {
  return function (target: Object, propertyKey: string | symbol) {
    if (typeof propertyKey === 'symbol') return;
    addValidationRule(target.constructor.prototype, propertyKey, {
      type: 'minLength',
      value,
      message: message ?? `Length must be at least ${value}`,
    });
  };
}

/**
 * @MaxLength decorator - validates maximum string/array length.
 *
 * @example
 * ```typescript
 * @Input({ type: 'string', source: 'config' })
 * @MaxLength(255)
 * description!: string;
 * ```
 */
export function MaxLength(value: number, message?: string): PropertyDecorator {
  return function (target: Object, propertyKey: string | symbol) {
    if (typeof propertyKey === 'symbol') return;
    addValidationRule(target.constructor.prototype, propertyKey, {
      type: 'maxLength',
      value,
      message: message ?? `Length must be at most ${value}`,
    });
  };
}

/**
 * @Pattern decorator - validates string against a regex pattern.
 *
 * @example
 * ```typescript
 * @Input({ type: 'string', source: 'config' })
 * @Pattern(/^[a-z0-9-]+$/)
 * slug!: string;
 * ```
 */
export function Pattern(pattern: RegExp, message?: string): PropertyDecorator {
  return function (target: Object, propertyKey: string | symbol) {
    if (typeof propertyKey === 'symbol') return;
    addValidationRule(target.constructor.prototype, propertyKey, {
      type: 'pattern',
      value: pattern,
      message: message ?? `Value must match pattern ${pattern}`,
    });
  };
}

/**
 * @Email decorator - validates email format.
 *
 * @example
 * ```typescript
 * @Input({ type: 'string', source: 'config' })
 * @Email()
 * emailAddress!: string;
 * ```
 */
export function Email(message?: string): PropertyDecorator {
  return function (target: Object, propertyKey: string | symbol) {
    if (typeof propertyKey === 'symbol') return;
    addValidationRule(target.constructor.prototype, propertyKey, {
      type: 'email',
      message: message ?? 'Value must be a valid email address',
    });
  };
}

/**
 * @Url decorator - validates URL format.
 *
 * @example
 * ```typescript
 * @Input({ type: 'string', source: 'config' })
 * @Url()
 * webhookUrl!: string;
 * ```
 */
export function Url(message?: string): PropertyDecorator {
  return function (target: Object, propertyKey: string | symbol) {
    if (typeof propertyKey === 'symbol') return;
    addValidationRule(target.constructor.prototype, propertyKey, {
      type: 'url',
      message: message ?? 'Value must be a valid URL',
    });
  };
}

/**
 * Validate a value against a set of rules.
 * Returns an array of error messages (empty if valid).
 */
export function validateValue(value: unknown, rules: ValidationRule[]): string[] {
  const errors: string[] = [];

  for (const rule of rules) {
    switch (rule.type) {
      case 'min':
        if (typeof value === 'number' && value < rule.value) {
          errors.push(rule.message ?? `Value must be at least ${rule.value}`);
        }
        break;

      case 'max':
        if (typeof value === 'number' && value > rule.value) {
          errors.push(rule.message ?? `Value must be at most ${rule.value}`);
        }
        break;

      case 'minLength':
        if (
          (typeof value === 'string' || Array.isArray(value)) &&
          value.length < rule.value
        ) {
          errors.push(rule.message ?? `Length must be at least ${rule.value}`);
        }
        break;

      case 'maxLength':
        if (
          (typeof value === 'string' || Array.isArray(value)) &&
          value.length > rule.value
        ) {
          errors.push(rule.message ?? `Length must be at most ${rule.value}`);
        }
        break;

      case 'pattern':
        if (typeof value === 'string' && !rule.value.test(value)) {
          errors.push(rule.message ?? `Value must match pattern ${rule.value}`);
        }
        break;

      case 'email': {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (typeof value === 'string' && !emailRegex.test(value)) {
          errors.push(rule.message ?? 'Value must be a valid email address');
        }
        break;
      }

      case 'url':
        if (typeof value === 'string') {
          try {
            new URL(value);
          } catch {
            errors.push(rule.message ?? 'Value must be a valid URL');
          }
        }
        break;

      case 'custom': {
        const result = rule.validate(value);
        if (result !== true) {
          errors.push(typeof result === 'string' ? result : (rule.message ?? 'Validation failed'));
        }
        break;
      }
    }
  }

  return errors;
}
