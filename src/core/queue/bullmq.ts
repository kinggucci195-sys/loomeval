import { Queue, QueueOptions } from 'bullmq';
import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});

const defaultQueueOptions: QueueOptions = {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    timeout: 60000,
    removeOnFail: false,
  },
};

export const replayQueue = new Queue('replay', defaultQueueOptions);
export const experimentQueue = new Queue('experiment', defaultQueueOptions);
export const artifactQueue = new Queue('artifact', defaultQueueOptions);
export const retentionQueue = new Queue('retention', defaultQueueOptions);
