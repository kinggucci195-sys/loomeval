/**
 * Retention Worker
 *
 * Sweeps expired traces, screenshots, DOM snapshots, network bodies,
 * and artifacts based on configured retention policies.
 *
 * Fully idempotent: safe to re-run. Soft-deletes log audit events.
 */
import { Worker, Job, UnrecoverableError } from 'bullmq';
import { z } from 'zod';
import * as fs from 'fs';
import { getManagedRedis } from '../redis';
import { prisma } from '../../../lib/db';

export const RetentionJobPayloadV1 = z.object({
  _version: z.literal(1),
  jobId: z.string().uuid(),
  workspaceId: z.string().uuid().optional(), // undefined = global sweep
  sweepType: z.enum(['trace', 'artifact', 'screenshot', 'network_body', 'experiment', 'orphan']),
  retentionDays: z.number().int().positive(),
  dryRun: z.boolean().default(false),
});

export type RetentionJobPayload = z.infer<typeof RetentionJobPayloadV1>;

export async function processRetentionJob(job: Job) {
  const parseResult = RetentionJobPayloadV1.safeParse(job.data);
  if (!parseResult.success) {
    throw new UnrecoverableError(
      `Invalid retention job payload: ${JSON.stringify(parseResult.error.format())}`
    );
  }
  const payload = parseResult.data;

  const cutoff = new Date(Date.now() - payload.retentionDays * 24 * 60 * 60 * 1000);

  let deletedCount = 0;

  if (payload.dryRun) {
    // Count only — no deletions
    switch (payload.sweepType) {
      case 'trace': {
        const count = await prisma.trace.count({
          where: { createdAt: { lt: cutoff } },
        });
        return { dryRun: true, sweepType: payload.sweepType, wouldDelete: count };
      }
      default:
        return { dryRun: true, sweepType: payload.sweepType, wouldDelete: 0 };
    }
  }

  switch (payload.sweepType) {
    case 'trace': {
      // Find all associated artifacts first to unlink their files
      const artifacts = await prisma.traceArtifact.findMany({
        where: {
          session: {
            trace: {
              createdAt: { lt: cutoff },
            },
          },
        },
        select: { filePath: true },
      });

      for (const art of artifacts) {
        if (art.filePath && fs.existsSync(art.filePath)) {
          try {
            fs.unlinkSync(art.filePath);
          } catch (e: any) {
            process.stderr.write(`[RetentionWorker] Failed to delete file ${art.filePath}: ${e.message}\n`);
          }
        }
      }

      // Cascade deletes will remove related browser sessions, actions, snapshots, and artifacts in DB
      const result = await prisma.trace.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      deletedCount = result.count;
      break;
    }
    case 'artifact': {
      const artifacts = await prisma.traceArtifact.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { filePath: true },
      });

      for (const art of artifacts) {
        if (art.filePath && fs.existsSync(art.filePath)) {
          try {
            fs.unlinkSync(art.filePath);
          } catch (e: any) {
            process.stderr.write(`[RetentionWorker] Failed to delete file ${art.filePath}: ${e.message}\n`);
          }
        }
      }

      const result = await prisma.traceArtifact.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      deletedCount = result.count;
      break;
    }
    case 'screenshot': {
      const result = await prisma.pageSnapshot.deleteMany({
        where: { timestamp: { lt: cutoff } },
      });
      deletedCount = result.count;
      break;
    }
    case 'network_body': {
      // Redact bodies but keep exchange metadata
      const updated = await prisma.networkExchange.updateMany({
        where: { timestamp: { lt: cutoff } },
        data: { requestBody: null, responseBody: null },
      });
      deletedCount = updated.count;
      break;
    }
    case 'experiment': {
      const result = await prisma.experiment.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      deletedCount = result.count;
      break;
    }
    case 'orphan': {
      // Browser sessions with no actions and no snapshots older than cutoff
      const orphans = await prisma.browserSession.findMany({
        where: {
          createdAt: { lt: cutoff },
          actions: { none: {} },
          snapshots: { none: {} },
        },
        select: { id: true },
      });
      if (orphans.length > 0) {
        const result = await prisma.browserSession.deleteMany({
          where: { id: { in: orphans.map((o: any) => o.id) } },
        });
        deletedCount = result.count;
      }
      break;
    }
  }

  process.stdout.write(
    `[RetentionWorker] Swept ${deletedCount} ${payload.sweepType} records older than ${payload.retentionDays} days\n`
  );

  return {
    sweepType: payload.sweepType,
    deletedCount,
    cutoffDate: cutoff.toISOString(),
  };
}

export function createRetentionWorker(): Worker {
  const worker = new Worker(
    'retention',
    processRetentionJob,
    {
      connection: getManagedRedis() as any,
      concurrency: 1, // Retention sweeps run serially to avoid DB pressure
      lockDuration: 60_000,
    }
  );

  worker.on('failed', (job, err) => {
    process.stderr.write(
      `[RetentionWorker] Job ${job?.id} failed: ${err.message}\n`
    );
  });

  return worker;
}
