import type { RedisClientType } from 'redis';
import type { Lock } from '@flowmonkey/core';

/**
 * Distributed locking via Redis.
 */
export class RedisLockManager {
  constructor(private redis: RedisClientType) {}

  /**
   * Try to acquire a lock.
   * @param key Lock key
   * @param ttlMs How long to hold the lock
   * @returns Lock with release() and extend() methods, or null if held by another
   */
  async acquire(key: string, ttlMs: number): Promise<Lock | null> {
    const owner = crypto.randomUUID();
    const lockKey = `lock:${key}`;
    const expiresAt = Date.now() + ttlMs;

    // Try to set if not exists or expired
    const result = await this.redis.set(
      lockKey,
      JSON.stringify({ owner, expiresAt }),
      {
        NX: true,
        PX: ttlMs,
      }
    );

    if (!result) {
      return null;
    }

    return {
      release: async () => {
        // Only release if we still own it
        const current = await this.redis.get(lockKey);
        if (current) {
          const { owner: currentOwner } = JSON.parse(current);
          if (currentOwner === owner) {
            await this.redis.del(lockKey);
          }
        }
      },
      extend: async (newTtlMs: number) => {
        // Only extend if we still own it
        const current = await this.redis.get(lockKey);
        if (current) {
          const { owner: currentOwner } = JSON.parse(current);
          if (currentOwner === owner) {
            await this.redis.pExpire(lockKey, newTtlMs);
            return true;
          }
        }
        return false;
      },
    };
  }
}
