import { describe, it, expect, beforeAll } from 'vitest';
import { RateLimiter } from '../security/rateLimiter';
import { getManagedRedis } from '../queue/redis';

describe('Distributed Rate Limiting Suite', () => {
  beforeAll(async () => {
    // Ensure redis is flushed/clean for testing
    const redis = getManagedRedis();
    await redis.flushdb();
  });

  it('should allow requests within limit and block when exceeded', async () => {
    const key = `key_${Date.now()}`;
    const limit = 3;

    // First 3 requests should pass
    for (let i = 0; i < limit; i++) {
      const res = await RateLimiter.checkRequestLimit({
        keyIdentifier: key,
        type: 'trace_write',
        limit,
      });
      expect(res.remaining).toBe(limit - (i + 1));
    }

    // 4th request must throw 429
    await expect(
      RateLimiter.checkRequestLimit({
        keyIdentifier: key,
        type: 'trace_write',
        limit,
      })
    ).rejects.toThrow(/Rate limit exceeded/);
  });

  it('should enforce upload bytes limits', async () => {
    const key = `key_bytes_${Date.now()}`;
    const limitBytes = 1000;

    // Add 800 bytes - should succeed
    await RateLimiter.checkBytesLimit({
      keyIdentifier: key,
      type: 'artifact_bytes',
      additionalBytes: 800,
      limitBytes,
    });

    // Add another 300 bytes - should exceed limit and throw
    await expect(
      RateLimiter.checkBytesLimit({
        keyIdentifier: key,
        type: 'artifact_bytes',
        additionalBytes: 300,
        limitBytes,
      })
    ).rejects.toThrow(/Upload bandwidth limit exceeded/);
  });

  it('should enforce active concurrency limits', async () => {
    const scopeId = `proj_${Date.now()}`;
    const limit = 2;

    const release1 = await RateLimiter.incrementConcurrency({
      scopeId,
      type: 'project',
      limit,
    });
    expect(release1).toBeDefined();

    const release2 = await RateLimiter.incrementConcurrency({
      scopeId,
      type: 'project',
      limit,
    });
    expect(release2).toBeDefined();

    // 3rd concurrent request should be blocked
    await expect(
      RateLimiter.incrementConcurrency({
        scopeId,
        type: 'project',
        limit,
      })
    ).rejects.toThrow(/Too many concurrent jobs running/);

    // Release one
    await release1();

    // Now it should pass
    const release3 = await RateLimiter.incrementConcurrency({
      scopeId,
      type: 'project',
      limit,
    });
    expect(release3).toBeDefined();

    await release2();
    await release3();
  });
});
