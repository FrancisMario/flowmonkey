/**
 * VaultProvider - Interface for secrets management.
 *
 * This interface is defined in core but implementations are
 * provided at the app layer where tenant context is available.
 *
 * Vault paths use dot notation: 'category.subcategory.key'
 * Examples:
 *   - 'llm.openai.apikey'
 *   - 'email.smtp.password'
 *   - 'api.stripe.secretkey'
 *   - 'database.primary.connectionstring'
 */

/**
 * Interface for accessing secrets/credentials.
 *
 * Implementations handle:
 * - Tenant isolation
 * - Encryption at rest
 * - Access control
 * - Audit logging
 *
 * Core only defines the interface; app layer provides implementation.
 */
export interface VaultProvider {
  /**
   * Get a secret value by path.
   *
   * @param path - Dot-notation path (e.g., 'llm.openai.apikey')
   * @returns The secret value, or null if not found
   */
  get(path: string): Promise<string | null>;

  /**
   * Set a secret value.
   *
   * @param path - Dot-notation path
   * @param value - The secret value to store
   */
  set(path: string, value: string): Promise<void>;

  /**
   * Delete a secret.
   *
   * @param path - Dot-notation path
   */
  delete(path: string): Promise<void>;

  /**
   * List all secret paths under a prefix.
   *
   * @param prefix - Path prefix to list (e.g., 'llm' lists 'llm.openai.apikey', 'llm.anthropic.apikey')
   * @returns Array of full paths
   */
  list(prefix: string): Promise<string[]>;
}

/**
 * No-op vault provider for testing or when secrets aren't needed.
 */
export class NoopVaultProvider implements VaultProvider {
  async get(): Promise<string | null> {
    return null;
  }

  async set(): Promise<void> {
    // No-op
  }

  async delete(): Promise<void> {
    // No-op
  }

  async list(): Promise<string[]> {
    return [];
  }
}

/**
 * In-memory vault provider for testing.
 */
export class MemoryVaultProvider implements VaultProvider {
  private secrets = new Map<string, string>();

  async get(path: string): Promise<string | null> {
    return this.secrets.get(path) ?? null;
  }

  async set(path: string, value: string): Promise<void> {
    this.secrets.set(path, value);
  }

  async delete(path: string): Promise<void> {
    this.secrets.delete(path);
  }

  async list(prefix: string): Promise<string[]> {
    const results: string[] = [];
    for (const key of this.secrets.keys()) {
      if (key.startsWith(prefix)) {
        results.push(key);
      }
    }
    return results;
  }

  /**
   * Clear all secrets (for testing).
   */
  clear(): void {
    this.secrets.clear();
  }

  /**
   * Seed secrets for testing.
   */
  seed(secrets: Record<string, string>): void {
    for (const [path, value] of Object.entries(secrets)) {
      this.secrets.set(path, value);
    }
  }
}
