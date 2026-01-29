/**
 * Metadata keys and utilities for decorator reflection.
 */

import type { HandlerOptions, InputOptions, OutputOptions } from './handler';
import type { ValidationRule } from './validation';

// Metadata keys (using symbols for uniqueness)
export const HANDLER_METADATA_KEY = Symbol('flowmonkey:handler');
export const INPUT_METADATA_KEY = Symbol('flowmonkey:input');
export const OUTPUT_METADATA_KEY = Symbol('flowmonkey:output');
export const VALIDATION_METADATA_KEY = Symbol('flowmonkey:validation');

/**
 * Storage for handler metadata (since we can't use reflect-metadata).
 * Maps constructor → metadata.
 */
const handlerMetadataStore = new WeakMap<object, HandlerOptions>();
const inputMetadataStore = new WeakMap<object, Map<string, InputOptions>>();
const outputMetadataStore = new WeakMap<object, Map<string, OutputOptions & { transition: 'success' | 'failure' }>>();
const validationMetadataStore = new WeakMap<object, Map<string, ValidationRule[]>>();

/**
 * Set handler-level metadata.
 */
export function setHandlerMetadata(target: object, options: HandlerOptions): void {
  handlerMetadataStore.set(target, options);
}

/**
 * Get handler-level metadata.
 */
export function getHandlerMetadata(target: object): HandlerOptions | undefined {
  // Check the constructor itself first, then prototype chain
  let current: object | null = target;
  while (current) {
    const metadata = handlerMetadataStore.get(current);
    if (metadata) return metadata;
    current = Object.getPrototypeOf(current);
  }
  return undefined;
}

/**
 * Set input metadata for a property.
 */
export function setInputMetadata(target: object, propertyKey: string, options: InputOptions): void {
  let inputs = inputMetadataStore.get(target);
  if (!inputs) {
    inputs = new Map();
    inputMetadataStore.set(target, inputs);
  }
  inputs.set(propertyKey, options);
}

/**
 * Get all input metadata for a handler.
 */
export function getInputMetadata(target: object): Map<string, InputOptions> {
  const result = new Map<string, InputOptions>();

  // Collect from prototype chain (parent first, child overrides)
  const chain: object[] = [];
  let current: object | null = target;
  while (current) {
    chain.unshift(current);
    current = Object.getPrototypeOf(current);
  }

  for (const proto of chain) {
    const inputs = inputMetadataStore.get(proto);
    if (inputs) {
      for (const [key, value] of inputs) {
        result.set(key, value);
      }
    }
  }

  return result;
}

/**
 * Set output metadata for a property.
 */
export function setOutputMetadata(
  target: object,
  propertyKey: string,
  options: OutputOptions & { transition: 'success' | 'failure' }
): void {
  let outputs = outputMetadataStore.get(target);
  if (!outputs) {
    outputs = new Map();
    outputMetadataStore.set(target, outputs);
  }
  outputs.set(propertyKey, options);
}

/**
 * Get all output metadata for a handler.
 */
export function getOutputMetadata(
  target: object
): Map<string, OutputOptions & { transition: 'success' | 'failure' }> {
  const result = new Map<string, OutputOptions & { transition: 'success' | 'failure' }>();

  const chain: object[] = [];
  let current: object | null = target;
  while (current) {
    chain.unshift(current);
    current = Object.getPrototypeOf(current);
  }

  for (const proto of chain) {
    const outputs = outputMetadataStore.get(proto);
    if (outputs) {
      for (const [key, value] of outputs) {
        result.set(key, value);
      }
    }
  }

  return result;
}

/**
 * Add a validation rule to a property.
 */
export function addValidationRule(target: object, propertyKey: string, rule: ValidationRule): void {
  let validations = validationMetadataStore.get(target);
  if (!validations) {
    validations = new Map();
    validationMetadataStore.set(target, validations);
  }

  let rules = validations.get(propertyKey);
  if (!rules) {
    rules = [];
    validations.set(propertyKey, rules);
  }

  rules.push(rule);
}

/**
 * Get validation rules for a property.
 */
export function getValidationRules(target: object, propertyKey: string): ValidationRule[] {
  const result: ValidationRule[] = [];

  const chain: object[] = [];
  let current: object | null = target;
  while (current) {
    chain.unshift(current);
    current = Object.getPrototypeOf(current);
  }

  for (const proto of chain) {
    const validations = validationMetadataStore.get(proto);
    if (validations) {
      const rules = validations.get(propertyKey);
      if (rules) {
        result.push(...rules);
      }
    }
  }

  return result;
}

/**
 * Get all validation rules for all properties of a handler.
 */
export function getAllValidationRules(target: object): Map<string, ValidationRule[]> {
  const result = new Map<string, ValidationRule[]>();

  const chain: object[] = [];
  let current: object | null = target;
  while (current) {
    chain.unshift(current);
    current = Object.getPrototypeOf(current);
  }

  for (const proto of chain) {
    const validations = validationMetadataStore.get(proto);
    if (validations) {
      for (const [key, rules] of validations) {
        const existing = result.get(key) || [];
        result.set(key, [...existing, ...rules]);
      }
    }
  }

  return result;
}
