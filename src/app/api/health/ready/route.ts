import { NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import IORedis from 'ioredis';

export async function GET() {
  try {
    // 1. Database liveness check
    await prisma.$queryRaw`SELECT 1`;

    // 2. Redis liveness check
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error('REDIS_URL environment variable is not set');
    }

    const redis = new IORedis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
    });

    const pingRes = await redis.ping();
    await redis.quit();

    if (pingRes !== 'PONG') {
      throw new Error('Redis ping response was not PONG');
    }

    return NextResponse.json({ status: 'ready' }, { status: 200 });
  } catch (error: any) {
    console.error('Readiness check failed:', error);
    return NextResponse.json(
      { status: 'unhealthy', error: error.message || String(error) },
      { status: 503 }
    );
  }
}
