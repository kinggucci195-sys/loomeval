import { Worker } from 'bullmq';
import { createReplayWorker } from './workers/replayWorker';
import { createRetentionWorker } from './workers/retentionWorker';
import { createArtifactWorker } from './workers/artifactWorker';
import { createExperimentWorker } from './workers/experimentWorker';
import { shutdownRedis } from './redis';

/**
 * Worker Manager
 *
 * Orchestrates worker starts and graceful shutdowns.
 */
export class WorkerManager {
  private workers: Worker[] = [];
  private static instance: WorkerManager | null = null;

  private constructor() {}

  static getInstance(): WorkerManager {
    if (!this.instance) {
      this.instance = new WorkerManager();
    }
    return this.instance;
  }

  /**
   * Start all queues workers.
   */
  start(): void {
    if (this.workers.length > 0) return;

    process.stdout.write('[WorkerManager] Registering and starting workers...\n');
    this.workers.push(createReplayWorker());
    this.workers.push(createRetentionWorker());
    this.workers.push(createArtifactWorker());
    this.workers.push(createExperimentWorker());
  }

  /**
   * Graceful shutdown of all workers and Redis connection.
   */
  async shutdown(): Promise<void> {
    process.stdout.write('[WorkerManager] Initiating graceful shutdown of all queue workers...\n');

    // Close workers in parallel
    await Promise.all(this.workers.map((w) => w.close()));
    this.workers = [];

    // Close Redis connection
    await shutdownRedis();

    process.stdout.write('[WorkerManager] All workers shut down successfully.\n');
  }
}
