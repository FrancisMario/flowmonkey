/**
 * BaseHandler - Abstract base class for all handlers.
 *
 * Provides common functionality for input resolution, validation,
 * and metadata access. Not meant to be extended directly - use
 * StatelessHandler or StatefulHandler.
 */

import type { Step } from '../types/flow';
import type { Execution } from '../types/execution';
import type { StepResult } from '../types/result';
import type { ValidationIssue } from '../types/errors';
import type {
  ContextHelpers,
  HandlerMetadata,
  JSONSchema,
} from '../interfaces/step-handler';
import type { ResumeTokenManager } from '../interfaces/resume-token-manager';
import type { VaultProvider } from '../interfaces/vault-provider';
import {
  getHandlerMetadata,
  getInputMetadata,
  getOutputMetadata,
  getAllValidationRules,
} from '../decorators/metadata';
import type { InputOptions } from '../decorators/handler';
import { validateValue, type ValidationRule } from '../decorators/validation';

/**
 * Context provided to handler execution.
 */
export interface HandlerContext {
  /** Current step definition */
  step: Step;
  /** Current execution state */
  execution: Execution;
  /** Context helpers for reading/writing execution context */
  ctx: ContextHelpers;
  /** Resume token manager for wait operations */
  tokenManager?: ResumeTokenManager;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Vault provider for secrets (injected by app layer) */
  vault?: VaultProvider;
  /** Raw context object */
  context: Record<string, unknown>;
  /** Resolved input from previous step or input selector */
  resolvedInput: unknown;
}

/**
 * Resolved inputs after processing @Input decorators.
 */
export type ResolvedInputs<T> = T;

/**
 * Abstract base class for all handlers.
 *
 * @typeParam TInput - Type of resolved inputs (populated by @Input decorators)
 * @typeParam TSuccessOutput - Type of success output
 * @typeParam TFailureOutput - Type of failure output
 */
export abstract class BaseHandler<
  TInput = unknown,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _TSuccessOutput = unknown,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _TFailureOutput = unknown,
> {
  /**
   * Handler context, set before execute() is called.
   * @internal
   */
  protected _context!: HandlerContext;

  /**
   * Get the handler type from decorator metadata.
   */
  get type(): string {
    const metadata = getHandlerMetadata(this.constructor);
    if (!metadata) {
      throw new Error(
        `Handler ${this.constructor.name} is missing @Handler decorator`
      );
    }
    return metadata.type;
  }

  /**
   * Whether this handler is stateful (uses checkpoints/jobs).
   */
  get stateful(): boolean {
    const metadata = getHandlerMetadata(this.constructor);
    return metadata?.stateful ?? false;
  }

  /**
   * Get full handler metadata for registry.
   */
  get metadata(): HandlerMetadata {
    const options = getHandlerMetadata(this.constructor);
    if (!options) {
      throw new Error(
        `Handler ${this.constructor.name} is missing @Handler decorator`
      );
    }

    return {
      type: options.type,
      name: options.name,
      description: options.description,
      category: options.category,
      stateful: options.stateful,
      visual: options.visual,
      defaultTimeout: options.defaultTimeout,
      retryable: options.retryable,
      links: options.links,
      configSchema: this.buildConfigSchema(),
      inputSchema: this.buildInputSchema(),
      outputSchema: this.buildOutputSchema(),
    };
  }

  /**
   * Access the execution context.
   */
  protected get context(): HandlerContext {
    return this._context;
  }

  /**
   * Access context helpers.
   */
  protected get ctx(): ContextHelpers {
    return this._context.ctx;
  }

  /**
   * Access the current step.
   */
  protected get step(): Step {
    return this._context.step;
  }

  /**
   * Access the current execution.
   */
  protected get execution(): Execution {
    return this._context.execution;
  }

  /**
   * Access the abort signal.
   */
  protected get signal(): AbortSignal | undefined {
    return this._context.signal;
  }

  /**
   * Access the token manager for wait operations.
   */
  protected get tokenManager(): ResumeTokenManager | undefined {
    return this._context.tokenManager;
  }

  /**
   * Initialize handler with context. Called by engine before execute().
   * @internal
   */
  _init(context: HandlerContext): void {
    this._context = context;
  }

  /**
   * Resolve all inputs declared via @Input decorators.
   * @internal
   */
  async _resolveInputs(): Promise<TInput> {
    const inputMeta = getInputMetadata(this.constructor.prototype);
    const resolved: Record<string, unknown> = {};

    for (const [propertyKey, options] of inputMeta) {
      const value = await this.resolveInput(propertyKey, options);
      resolved[propertyKey] = value;

      // Also set on the instance for direct property access
      (this as any)[propertyKey] = value;
    }

    return resolved as TInput;
  }

  /**
   * Resolve a single input value.
   */
  private async resolveInput(
    propertyKey: string,
    options: InputOptions
  ): Promise<unknown> {
    const key = options.key ?? propertyKey;
    let value: unknown;

    switch (options.source) {
      case 'config':
        value = this._context.step.config[key];
        break;

      case 'context':
        value = await this._context.ctx.get(key);
        break;

      case 'previous':
        value = this._context.resolvedInput;
        break;

      case 'vault':
        if (!this._context.vault) {
          throw new Error(
            `Input '${propertyKey}' requires vault but no VaultProvider was configured`
          );
        }
        if (!options.vaultPath) {
          throw new Error(
            `Input '${propertyKey}' with source 'vault' requires vaultPath`
          );
        }
        value = await this._context.vault.get(options.vaultPath);
        break;

      default:
        throw new Error(`Unknown input source: ${options.source}`);
    }

    // Apply default if undefined
    if (value === undefined && options.defaultValue !== undefined) {
      value = options.defaultValue;
    }

    // Check required
    if (options.required && (value === undefined || value === null)) {
      throw new Error(
        `Required input '${propertyKey}' is missing (source: ${options.source}, key: ${key})`
      );
    }

    return value;
  }

  /**
   * Validate all resolved inputs against validation rules.
   * @internal
   */
  _validateInputs(): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const allRules = getAllValidationRules(this.constructor.prototype);

    for (const [propertyKey, rules] of allRules) {
      const value = (this as any)[propertyKey];
      const errors = validateValue(value, rules);

      for (const error of errors) {
        issues.push({
          path: propertyKey,
          message: error,
          severity: 'error',
        });
      }
    }

    return issues;
  }

  /**
   * Validate step config before execution.
   * Override to add custom validation.
   */
  async validateConfig(
    _config: Record<string, unknown>
  ): Promise<ValidationIssue[] | undefined> {
    return undefined;
  }

  /**
   * Cleanup resources. Override if handler holds resources.
   */
  async cleanup(): Promise<void> {
    // Default: no cleanup needed
  }

  /**
   * Execute the handler. Must be implemented by subclasses.
   */
  abstract execute(): Promise<StepResult>;

  /**
   * Build JSON schema for config from @Input decorators with source 'config'.
   */
  private buildConfigSchema(): JSONSchema {
    const inputMeta = getInputMetadata(this.constructor.prototype);
    const properties: Record<string, JSONSchema> = {};
    const required: string[] = [];

    for (const [propertyKey, options] of inputMeta) {
      if (options.source === 'config') {
        const key = options.key ?? propertyKey;
        properties[key] = {
          type: options.type === 'any' ? undefined : options.type,
          description: options.description,
          default: options.defaultValue,
        };

        if (options.required) {
          required.push(key);
        }

        // Add validation constraints
        const rules = getAllValidationRules(this.constructor.prototype).get(propertyKey) ?? [];
        this.applyValidationToSchema(properties[key], rules);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  /**
   * Build JSON schema for inputs (non-config).
   */
  private buildInputSchema(): JSONSchema | undefined {
    const inputMeta = getInputMetadata(this.constructor.prototype);
    const properties: Record<string, JSONSchema> = {};

    for (const [propertyKey, options] of inputMeta) {
      if (options.source !== 'config') {
        properties[propertyKey] = {
          type: options.type === 'any' ? undefined : options.type,
          description: options.description,
        };
      }
    }

    if (Object.keys(properties).length === 0) {
      return undefined;
    }

    return { type: 'object', properties };
  }

  /**
   * Build JSON schema for outputs.
   */
  private buildOutputSchema(): JSONSchema | undefined {
    const outputMeta = getOutputMetadata(this.constructor.prototype);
    const properties: Record<string, JSONSchema> = {};

    for (const [propertyKey, options] of outputMeta) {
      properties[propertyKey] = {
        type: options.type === 'any' ? undefined : options.type,
        description: options.description,
      };
    }

    if (Object.keys(properties).length === 0) {
      return undefined;
    }

    return { type: 'object', properties };
  }

  /**
   * Apply validation rules to JSON schema.
   */
  private applyValidationToSchema(
    schema: JSONSchema,
    rules: ValidationRule[]
  ): void {
    for (const rule of rules) {
      switch (rule.type) {
        case 'min':
          schema.minimum = rule.value;
          break;
        case 'max':
          schema.maximum = rule.value;
          break;
        case 'minLength':
          schema.minLength = rule.value;
          break;
        case 'maxLength':
          schema.maxLength = rule.value;
          break;
        case 'pattern':
          schema.pattern = rule.value.source;
          break;
        case 'email':
          schema.format = 'email';
          break;
        case 'url':
          schema.format = 'uri';
          break;
      }
    }
  }
}
