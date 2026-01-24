import type { RedisClientType } from 'redis';
import type { Execution } from '@flowmonkey/core';

/**
 * Optional hot cache for frequently accessed executions.
 */
export class RedisExecutionCache {
  private ttlMs = 60000; // 1 minute

  constructor(private redis: RedisClientType) {}

  async get(id: string): Promise<Execution | null> {
    const key = `exec:${id}`;
    const data = await this.redis.get(key);
    if (!data) return null;
    return JSON.parse(data);
  }

  async set(execution: Execution): Promise<void> {
    const key = `exec:${execution.id}`;
    await this.redis.setEx(key, Math.ceil(this.ttlMs / 1000), JSON.stringify(execution));
  }

  async invalidate(id: string): Promise<void> {
    const key = `exec:${id}`;
    await this.redis.del(key);
  }

  async clear(): Promise<void> {
    // Scan for all exec: keys and delete
    let cursor = 0;
    do {
      const { cursor: nextCursor, keys } = await this.redis.scan(cursor, {
        MATCH: 'exec:*',
        COUNT: 100,
      });
      if (keys.length > 0) {
        await this.redis.del(keys);
      }
      cursor = nextCursor;
      if (cursor === 0) break;
    } while (true);
  }
}
