/**
 * Simple dependency injection container.
 *
 * Provides a lightweight way to register and resolve services.
 */

import type { ServiceToken } from './tokens';

/**
 * Factory function for lazy service creation.
 */
export type ServiceFactory<T> = (container: ServiceContainer) => T;

/**
 * Service entry - either an instance or a factory.
 */
type ServiceEntry<T = unknown> = {
  instance?: T;
  factory?: ServiceFactory<T>;
  singleton: boolean;
};

/**
 * Simple dependency injection container.
 *
 * @example
 * ```typescript
 * const container = new ServiceContainer();
 *
 * // Register a singleton instance
 * container.registerInstance(ServiceTokens.StateStore, stateStore);
 *
 * // Register a factory (lazy creation)
 * container.registerFactory(ServiceTokens.ExecutionEngine, (c) =>
 *   new ExecutionEngine({
 *     stateStore: c.resolve(ServiceTokens.StateStore),
 *     handlers: c.resolve(ServiceTokens.HandlerRegistry),
 *     flows: c.resolve(ServiceTokens.FlowRegistry),
 *   })
 * );
 *
 * // Resolve a service
 * const engine = container.resolve(ServiceTokens.ExecutionEngine);
 * ```
 */
export class ServiceContainer {
  private services = new Map<ServiceToken, ServiceEntry>();

  /**
   * Register a service instance (eager registration).
   */
  registerInstance<T>(token: ServiceToken, instance: T): this {
    this.services.set(token, { instance, singleton: true });
    return this;
  }

  /**
   * Register a service factory (lazy registration).
   *
   * @param token - Service token
   * @param factory - Factory function that creates the service
   * @param singleton - Whether to cache the instance (default: true)
   */
  registerFactory<T>(
    token: ServiceToken,
    factory: ServiceFactory<T>,
    singleton = true
  ): this {
    this.services.set(token, { factory: factory as ServiceFactory<unknown>, singleton });
    return this;
  }

  /**
   * Resolve a service by token.
   *
   * @throws Error if service not registered
   */
  resolve<T>(token: ServiceToken): T {
    const entry = this.services.get(token);
    if (!entry) {
      throw new Error(
        `Service not registered: ${String(token)}. Did you forget to register it?`
      );
    }

    // Return cached instance if available
    if (entry.instance !== undefined) {
      return entry.instance as T;
    }

    // Create instance from factory
    if (!entry.factory) {
      throw new Error(`Service ${String(token)} has no instance or factory`);
    }

    const instance = entry.factory(this) as T;

    // Cache if singleton
    if (entry.singleton) {
      entry.instance = instance;
    }

    return instance;
  }

  /**
   * Check if a service is registered.
   */
  has(token: ServiceToken): boolean {
    return this.services.has(token);
  }

  /**
   * Try to resolve a service, returning undefined if not registered.
   */
  tryResolve<T>(token: ServiceToken): T | undefined {
    if (!this.has(token)) {
      return undefined;
    }
    return this.resolve<T>(token);
  }

  /**
   * Clear all registered services.
   */
  clear(): void {
    this.services.clear();
  }

  /**
   * Get all registered service tokens.
   */
  getRegisteredTokens(): ServiceToken[] {
    return Array.from(this.services.keys());
  }
}
