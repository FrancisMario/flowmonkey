/**
 * Core handler decorators: @Handler, @Input, @SuccessOutput, @FailureOutput
 */

import { setHandlerMetadata, setInputMetadata, setOutputMetadata } from './metadata';

/**
 * Input source types.
 */
export type InputSource = 'context' | 'config' | 'vault' | 'previous';

/**
 * Handler category for organization.
 */
export type HandlerCategory = 'control' | 'data' | 'external' | 'ai' | 'utility';

/**
 * Options for @Handler decorator.
 */
export interface HandlerOptions {
  /** Unique handler type identifier (e.g., 'http', 'transform') */
  type: string;
  /** Human-readable name */
  name: string;
  /** Description of what the handler does */
  description?: string;
  /** Category for grouping */
  category?: HandlerCategory;
  /** Whether this handler is stateful (uses checkpoints, long-running) */
  stateful?: boolean;
  /** Default timeout in ms */
  defaultTimeout?: number;
  /** Whether failures are retryable by default */
  retryable?: boolean;
  /** Handler version (semver recommended) */
  version?: string;
  /** Deprecation info */
  deprecated?: boolean | { since: string; message?: string; useInstead?: string };
  /** Visual metadata for UI */
  visual?: {
    icon?: string;
    color?: string;
    tags?: string[];
  };
  /** Documentation links */
  links?: {
    docs?: string;
    source?: string;
  };
}

/**
 * Primitive types for inputs/outputs.
 */
export type PrimitiveType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'any'
  | 'null';

/**
 * Options for @Input decorator.
 */
export interface InputOptions {
  /** Data type */
  type: PrimitiveType;
  /** Where to get the value from */
  source: InputSource;
  /** Vault path (required if source is 'vault') */
  vaultPath?: string;
  /** Context/config key (defaults to property name) */
  key?: string;
  /** Whether this input is required */
  required?: boolean;
  /** Description for documentation */
  description?: string;
  /** Default value if not provided */
  defaultValue?: unknown;
}

/**
 * Options for @SuccessOutput and @FailureOutput decorators.
 */
export interface OutputOptions {
  /** Data type of the output */
  type: PrimitiveType;
  /** Description for documentation */
  description?: string;
  /** Whether the output can be null/undefined */
  nullable?: boolean;
}

/**
 * @Handler decorator - marks a class as a FlowMonkey handler.
 *
 * @example
 * ```typescript
 * @Handler({
 *   type: 'http',
 *   name: 'HTTP Request',
 *   description: 'Makes HTTP requests',
 *   category: 'external'
 * })
 * export class HttpHandler extends StatelessHandler<HttpInput, HttpOutput> {
 *   // ...
 * }
 * ```
 */
export function Handler(options: HandlerOptions): ClassDecorator {
  return function (target: Function) {
    // Validate required fields
    if (!options.type) {
      throw new Error(`@Handler decorator requires 'type' option`);
    }
    if (!options.name) {
      throw new Error(`@Handler decorator requires 'name' option`);
    }

    // Store metadata on the constructor
    setHandlerMetadata(target, options);

    return target as any;
  };
}

/**
 * @Input decorator - declares an input property.
 *
 * @example
 * ```typescript
 * class MyHandler extends StatelessHandler {
 *   @Input({ type: 'string', source: 'config', required: true })
 *   url!: string;
 *
 *   @Input({ type: 'string', source: 'vault', vaultPath: 'api.keys.myservice' })
 *   apiKey!: string;
 *
 *   @Input({ type: 'object', source: 'previous' })
 *   previousResult?: Record<string, unknown>;
 * }
 * ```
 */
export function Input(options: InputOptions): PropertyDecorator {
  return function (target: Object, propertyKey: string | symbol) {
    if (typeof propertyKey === 'symbol') {
      throw new Error('@Input decorator cannot be used on symbol properties');
    }

    // Validate vault path requirement
    if (options.source === 'vault' && !options.vaultPath) {
      throw new Error(
        `@Input for property '${propertyKey}' with source 'vault' requires 'vaultPath' option`
      );
    }

    // Store metadata on the prototype
    setInputMetadata(target.constructor.prototype, propertyKey, {
      ...options,
      key: options.key ?? propertyKey,
    });
  };
}

/**
 * @SuccessOutput decorator - declares the output schema for success path.
 *
 * @example
 * ```typescript
 * class MyHandler extends StatelessHandler {
 *   @SuccessOutput({ type: 'object', description: 'HTTP response data' })
 *   declare result: { status: number; body: unknown };
 * }
 * ```
 */
export function SuccessOutput(options: OutputOptions): PropertyDecorator {
  return function (target: Object, propertyKey: string | symbol) {
    if (typeof propertyKey === 'symbol') {
      throw new Error('@SuccessOutput decorator cannot be used on symbol properties');
    }

    setOutputMetadata(target.constructor.prototype, propertyKey, {
      ...options,
      transition: 'success',
    });
  };
}

/**
 * @FailureOutput decorator - declares the output schema for failure path.
 *
 * @example
 * ```typescript
 * class MyHandler extends StatelessHandler {
 *   @FailureOutput({ type: 'object', description: 'Error details' })
 *   declare error: { code: string; message: string };
 * }
 * ```
 */
export function FailureOutput(options: OutputOptions): PropertyDecorator {
  return function (target: Object, propertyKey: string | symbol) {
    if (typeof propertyKey === 'symbol') {
      throw new Error('@FailureOutput decorator cannot be used on symbol properties');
    }

    setOutputMetadata(target.constructor.prototype, propertyKey, {
      ...options,
      transition: 'failure',
    });
  };
}
