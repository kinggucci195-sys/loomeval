/**
 * Managed Redis singleton.
 *
 * All BullMQ queues, workers, rate limiters, and health checks share
 * this connection instead of creating per-request clients.
 *
 * Graceful shutdown is handled via the shutdown() export.
 */
import IORedis from 'ioredis';

let _redis: IORedis | null = null;

export function getManagedRedis(): IORedis {
  if (_redis) return _redis;

  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  _redis = new IORedis(url, {
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
    lazyConnect: false,
    connectTimeout: 5000,
    commandTimeout: 5000,
    retryStrategy: (times: number) => {
      if (times > 10) return null; // stop retrying
      return Math.min(times * 100, 3000);
    },
  });

  _redis.on('error', (err: Error) => {
    // Log but never crash — let health checks report unavailability
    process.stderr.write(`[Redis] connection error: ${err.message}\n`);
  });

  return _redis;
}

/**
 * Gracefully close the managed Redis connection.
 * Call this in SIGTERM/SIGINT handlers.
 */
export async function shutdownRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit().catch(() => _redis?.disconnect());
    _redis = null;
  }
}
