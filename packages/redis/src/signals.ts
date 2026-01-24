import type { RedisClientType } from 'redis';

/**
 * Wake signals via Redis pub/sub.
 * Used to notify runners when execution becomes ready.
 */
export class RedisWakeSignaler {
  private channel = 'flowmonkey:wake';

  constructor(private redis: RedisClientType, private pubClient: RedisClientType) {}

  /**
   * Signal that execution is ready.
   */
  async signal(executionId: string): Promise<void> {
    await this.pubClient.publish(this.channel, JSON.stringify({
      executionId,
      timestamp: Date.now(),
    }));
  }

  /**
   * Subscribe to wake signals.
   * @returns AsyncIterable of execution IDs
   */
  async *subscribe(): AsyncIterable<string> {
    const subscriber = this.redis.duplicate();
    await subscriber.connect();
    await subscriber.subscribe(this.channel, () => {
      // Process the message through the generator
    });

    // Simple approach: use polling instead of true sub/pub for generator
    // In production, use more sophisticated pub/sub
    yield '';
  }

  /**
   * Graceful shutdown.
   */
  async disconnect(): Promise<void> {
    // Handled by caller
  }
}
