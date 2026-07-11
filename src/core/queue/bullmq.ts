/**
 * BullMQ queue definitions with durable job configuration.
 *
 * All queues use the managed Redis singleton.
 * Workers are in ./workers/*.ts — this file only declares queues.
 */
import { Queue, QueueEvents } from 'bullmq';
import { getManagedRedis } from './redis';

const connection = getManagedRedis() as any;

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 1000,
  },
  timeout: 60_000,
  removeOnComplete: { count: 100 },
  removeOnFail: false, // Keep failed jobs for dead-letter inspection
};

export const replayQueue = new Queue('replay', {
  connection,
  defaultJobOptions: DEFAULT_JOB_OPTIONS as any,
});

export const experimentQueue = new Queue('experiment', {
  connection,
  defaultJobOptions: {
    ...DEFAULT_JOB_OPTIONS,
    timeout: 300_000, // 5 min for multi-trial experiments
  } as any,
});

export const artifactQueue = new Queue('artifact', {
  connection,
  defaultJobOptions: DEFAULT_JOB_OPTIONS as any,
});

export const retentionQueue = new Queue('retention', {
  connection,
  defaultJobOptions: {
    ...DEFAULT_JOB_OPTIONS,
    attempts: 5,   // More retries for sweeps
    timeout: 120_000,
  } as any,
});

// Queue events (for monitoring dead-letter and stalled jobs)
export const replayQueueEvents = new QueueEvents('replay', { connection });
export const experimentQueueEvents = new QueueEvents('experiment', { connection });

export { DEFAULT_JOB_OPTIONS };
