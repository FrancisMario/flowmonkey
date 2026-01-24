import type { Pool } from 'pg';
import type { Flow, FlowRegistry, ValidationIssue } from '@flowmonkey/core';
import { FlowValidationError, validateFlow } from '@flowmonkey/core';

export class PgFlowStore implements FlowRegistry {
  private cache = new Map<string, Flow>(); // key: "id@version"
  private latest = new Map<string, string>(); // key: id, value: version
  private versionMap = new Map<string, Set<string>>(); // key: id, value: Set<version>

  constructor(private pool: Pool) {}

  /** Load all flows into cache. Call on startup. */
  async init(): Promise<void> {
    const { rows } = await this.pool.query(
      `SELECT id, version, definition FROM fm_flows ORDER BY id, version`
    );

    for (const row of rows) {
      const flow = row.definition as Flow;
      this.cacheFlow(flow);
    }
  }

  register(flow: Flow): void {
    const issues = this.validate(flow);
    const errors = issues.filter(i => i.severity === 'error');
    if (errors.length > 0) {
      throw new FlowValidationError(flow.id, errors);
    }

    // Check for duplicate
    if (this.cache.has(`${flow.id}@${flow.version}`)) {
      throw new Error(`Flow "${flow.id}@${flow.version}" already registered`);
    }

    // Persist (fire and forget - cache is authoritative for reads)
    this.pool.query(
      `INSERT INTO fm_flows (id, version, name, definition, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id, version) DO NOTHING`,
      [flow.id, flow.version, flow.name ?? null, JSON.stringify(flow), Date.now()]
    ).catch(err => console.error('Failed to persist flow:', err));

    this.cacheFlow(flow);
  }

  get(id: string, version?: string): Flow | undefined {
    const v = version ?? this.latest.get(id);
    if (!v) return undefined;
    return this.cache.get(`${id}@${v}`);
  }

  has(id: string): boolean {
    return this.latest.has(id);
  }

  flowIds(): string[] {
    return [...this.latest.keys()];
  }

  versions(id: string): string[] {
    const versions = this.versionMap.get(id);
    if (!versions) return [];
    return [...versions].sort().reverse();
  }

  validate(flow: Flow): ValidationIssue[] {
    return validateFlow(flow);
  }

  private cacheFlow(flow: Flow): void {
    this.cache.set(`${flow.id}@${flow.version}`, flow);

    // Update version tracking
    let versions = this.versionMap.get(flow.id);
    if (!versions) {
      versions = new Set();
      this.versionMap.set(flow.id, versions);
    }
    versions.add(flow.version);

    // Update latest
    const current = this.latest.get(flow.id);
    if (!current || flow.version > current) {
      this.latest.set(flow.id, flow.version);
    }
  }
}
