import type {
  ContextHelpers,
  ContextStorage,
  ContextSetOptions,
  ContextReference,
} from '../interfaces/step-handler';
import {
  ContextValueTooLargeError,
  ContextSizeLimitError,
  ContextKeyLimitError,
  ContextNestingError,
} from '../types/errors';

/**
 * Context limit configuration.
 */
export interface ContextLimits {
  /** Max size of single value (bytes). Default: 1MB */
  maxValueSize: number;
  /** Max total context size (bytes). Default: 10MB */
  maxTotalSize: number;
  /** Max number of keys. Default: 500 */
  maxKeys: number;
  /** Max nesting depth. Default: 15 */
  maxDepth: number;
}

export const DEFAULT_CONTEXT_LIMITS: ContextLimits = {
  maxValueSize: 1 * 1024 * 1024,      // 1MB
  maxTotalSize: 10 * 1024 * 1024,     // 10MB
  maxKeys: 500,
  maxDepth: 15,
};

export type ContextStorageConfig = {
  inlineThreshold: number;
  maxSize: number;
  autoSummarize?: boolean;
  backend?: ContextStorage;
};

/**
 * Calculate the serialized size of a value in bytes.
 */
export function calculateValueSize(value: unknown): number {
  if (value === undefined) return 0;
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

/**
 * Calculate nesting depth of a value.
 */
export function calculateNestingDepth(value: unknown, depth = 0): number {
  if (value === null || typeof value !== 'object') return depth;

  if (Array.isArray(value)) {
    if (value.length === 0) return depth + 1;
    return Math.max(...value.map(v => calculateNestingDepth(v, depth + 1)));
  }

  const values = Object.values(value);
  if (values.length === 0) return depth + 1;
  return Math.max(...values.map(v => calculateNestingDepth(v, depth + 1)));
}

/**
 * Validate a context value against limits.
 */
export function validateContextValue(
  key: string,
  value: unknown,
  limits: ContextLimits
): void {
  const size = calculateValueSize(value);

  if (size > limits.maxValueSize) {
    throw new ContextValueTooLargeError(key, size, limits.maxValueSize);
  }

  const depth = calculateNestingDepth(value);
  if (depth > limits.maxDepth) {
    throw new ContextNestingError(key, depth, limits.maxDepth);
  }
}

export class ContextHelpersImpl implements ContextHelpers {
  private contextSize = 0;
  private readonly limits: ContextLimits;

  constructor(
    private readonly executionId: string,
    private readonly context: Record<string, unknown>,
    private readonly storage?: ContextStorage,
    private readonly config?: ContextStorageConfig,
    limits?: Partial<ContextLimits>
  ) {
    this.limits = { ...DEFAULT_CONTEXT_LIMITS, ...limits };
    // Calculate initial context size
    this.contextSize = calculateValueSize(context);
  }

  async get<T = unknown>(key: string): Promise<T> {
    const value = this.context[key];

    if (this.isReference(value)) {
      if (!this.storage) {
        throw new Error('Context storage backend not configured');
      }
      return (await this.storage.get(this.executionId, key)) as T;
    }

    return value as T;
  }

  async set(key: string, value: unknown, options?: ContextSetOptions): Promise<void> {
    // Validate value against limits
    validateContextValue(key, value, this.limits);

    const json = JSON.stringify(value);
    const size = Buffer.byteLength(json, 'utf8');

    // Check key count
    const keyCount = Object.keys(this.context).length;
    const isNewKey = !(key in this.context);
    if (isNewKey && keyCount >= this.limits.maxKeys) {
      throw new ContextKeyLimitError(keyCount + 1, this.limits.maxKeys);
    }

    // Calculate size change
    const oldSize = key in this.context ? calculateValueSize(this.context[key]) : 0;
    const newTotal = this.contextSize - oldSize + size;

    // Check total size limit
    if (newTotal > this.limits.maxTotalSize) {
      throw new ContextSizeLimitError(this.contextSize, size, this.limits.maxTotalSize);
    }

    const tier = this.determineStorageTier(size, options);

    if (tier === 'external') {
      if (!this.storage) throw new Error('Context storage backend not configured');
      const ref = await this.storage.set(this.executionId, key, value);
      this.context[key] = ref as unknown;
      // External storage ref is small, recalculate
      const refSize = calculateValueSize(ref);
      this.contextSize = this.contextSize - oldSize + refSize;
    } else {
      this.context[key] = value;
      this.contextSize = newTotal;
    }
  }

  has(key: string): boolean {
    return key in this.context;
  }

  async delete(key: string): Promise<void> {
    const value = this.context[key];
    if (value !== undefined) {
      const size = calculateValueSize(value);
      this.contextSize -= size;
    }
    if (this.isReference(value) && this.storage) {
      await this.storage.delete(this.executionId, key);
    }
    delete this.context[key];
  }

  async getAll<T = Record<string, unknown>>(keys: string[]): Promise<T> {
    const result: Record<string, unknown> = {};

    await Promise.all(
      keys.map(async key => {
        result[key] = await this.get(key);
      })
    );

    return result as T;
  }

  /** Get current context size in bytes */
  getSize(): number {
    return this.contextSize;
  }

  /** Get current limits */
  getLimits(): ContextLimits {
    return { ...this.limits };
  }

  private isReference(value: unknown): value is ContextReference {
    return (
      typeof value === 'object' &&
      value !== null &&
      '_ref' in (value as Record<string, unknown>) &&
      typeof (value as any)._ref === 'string' &&
      (value as any)._ref.startsWith('storage://')
    );
  }

  private determineStorageTier(size: number, options?: ContextSetOptions): 'inline' | 'external' {
    if (options?.force && options.tier) return options.tier;
    if (options?.tier === 'external') return 'external';
    if (this.config && size > this.config.inlineThreshold) return 'external';
    return 'inline';
  }
}
