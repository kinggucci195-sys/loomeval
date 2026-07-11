import { getManagedRedis } from '../queue/redis';
import { AppError } from '../errors/errors';

export class RateLimiter {
  /**
   * Enforces a rate limit on request counts using Redis atomic INCR.
   * Window size is 1 minute.
   */
  static async checkRequestLimit(options: {
    keyIdentifier: string;
    type: 'trace_write' | 'artifact_write' | 'replay_create' | 'experiment_create';
    limit: number;
  }): Promise<{ limit: number; remaining: number; resetTime: Date }> {
    const redis = getManagedRedis();
    const windowMinute = Math.floor(Date.now() / 60000);
    const redisKey = `rate_limit:req:${options.type}:${options.keyIdentifier}:${windowMinute}`;

    // Execute atomic increment and set expiration
    const current = await redis.incr(redisKey);
    if (current === 1) {
      await redis.expire(redisKey, 120); // 2 minutes TTL to ensure cleanup
    }

    const remaining = Math.max(0, options.limit - current);
    const resetTime = new Date((windowMinute + 1) * 60000);

    if (current > options.limit) {
      throw new AppError({
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Rate limit exceeded for ${options.type}. Limit is ${options.limit} requests/min. Try again at ${resetTime.toISOString()}`,
        status: 429,
        internalDetail: `Key ${options.keyIdentifier} reached count ${current}/${options.limit}`,
      });
    }

    return { limit: options.limit, remaining, resetTime };
  }

  /**
   * Enforces a rate limit on uploaded byte sizes per minute.
   */
  static async checkBytesLimit(options: {
    keyIdentifier: string;
    type: 'trace_bytes' | 'artifact_bytes';
    additionalBytes: number;
    limitBytes: number;
  }): Promise<void> {
    const redis = getManagedRedis();
    const windowMinute = Math.floor(Date.now() / 60000);
    const redisKey = `rate_limit:bytes:${options.type}:${options.keyIdentifier}:${windowMinute}`;

    const current = await redis.incrby(redisKey, options.additionalBytes);
    if (current === options.additionalBytes) {
      await redis.expire(redisKey, 120);
    }

    if (current > options.limitBytes) {
      throw new AppError({
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Upload bandwidth limit exceeded for ${options.type}. Limit is ${options.limitBytes} bytes/min.`,
        status: 429,
      });
    }
  }

  /**
   * Enforces a limit on concurrent running jobs (e.g. workspaces or projects).
   * Returns a release function to be called in a finally block.
   */
  static async incrementConcurrency(options: {
    scopeId: string;
    type: 'workspace' | 'project';
    limit: number;
  }): Promise<() => Promise<void>> {
    const redis = getManagedRedis();
    const redisKey = `concurrency:${options.type}:${options.scopeId}`;

    const current = await redis.incr(redisKey);
    // Safety TTL of 1 hour in case worker crashes and release is not called
    await redis.expire(redisKey, 3600);

    const release = async () => {
      const val = await redis.decr(redisKey);
      if (val < 0) {
        await redis.set(redisKey, 0);
      }
    };

    if (current > options.limit) {
      await release();
      throw new AppError({
        code: 'QUOTA_EXCEEDED',
        message: `Too many concurrent jobs running for this ${options.type}. Max limit is ${options.limit}.`,
        status: 429,
      });
    }

    return release;
  }
}
