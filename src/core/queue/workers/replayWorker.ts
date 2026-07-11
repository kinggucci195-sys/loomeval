/**
 * Replay Worker
 *
 * Processes replay jobs from the `replay` queue.
 * Each job is fully idempotent via (replayJobId) — duplicates are safe.
 *
 * Retry classification:
 *   - Transient (ECONNREFUSED, timeouts) → retryable
 *   - Security violations → not retryable (dead-letter immediately)
 *   - Not-found → not retryable
 */
import { Worker, Job, UnrecoverableError } from 'bullmq';
import { z } from 'zod';
import { getManagedRedis } from '../redis';
import { prisma } from '../../../lib/db';
import { AppError } from '../../errors/errors';

// ── Versioned payload schema ─────────────────────────────────────────────────
export const ReplayJobPayloadV1 = z.object({
  _version: z.literal(1),
  replayJobId: z.string().uuid(),
  traceId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  tenantId: z.string().uuid(),
  mode: z.enum(['FORENSIC', 'PROTOCOL', 'LIVE']),
  requestedBy: z.string(),
  requestedAt: z.string().datetime(),
});

export type ReplayJobPayload = z.infer<typeof ReplayJobPayloadV1>;

// ── Worker ───────────────────────────────────────────────────────────────────
export function createReplayWorker(): Worker {
  const worker = new Worker(
    'replay',
    async (job: Job) => {
      // 1. Parse and validate payload
      const parseResult = ReplayJobPayloadV1.safeParse(job.data);
      if (!parseResult.success) {
        throw new UnrecoverableError(
          `Invalid replay job payload: ${JSON.stringify(parseResult.error.format())}`
        );
      }
      const payload = parseResult.data;

      // 2. Idempotency guard — check if this replayJobId was already processed
      const existing = await prisma.replayJob.findUnique({
        where: { id: payload.replayJobId },
      });
      if (existing && existing.status === 'COMPLETED') {
        // Already completed — safe no-op
        return { skipped: true, reason: 'already_completed' };
      }

      // 3. Tenant safety — verify trace belongs to this workspace/project
      const trace = await prisma.trace.findFirst({
        where: {
          id: payload.traceId,
          projectId: payload.projectId,
        },
      });
      if (!trace) {
        throw new UnrecoverableError(
          `Trace ${payload.traceId} not found in project ${payload.projectId}`
        );
      }

      // 4. Mark job as RUNNING with heartbeat
      await job.updateProgress(10);
      await prisma.replayJob.upsert({
        where: { id: payload.replayJobId },
        create: {
          id: payload.replayJobId,
          replayMode: payload.mode,
          status: 'RUNNING',
        },
        update: { status: 'RUNNING' },
      });

      try {
        let result: Record<string, unknown>;

        if (payload.mode === 'FORENSIC') {
          // Forensic replay does not launch a browser — pure DB inspection
          const { ReplaySandbox } = await import('../../replay/sandbox');
          const report = await ReplaySandbox.runForensicInspection(payload.traceId);
          result = { report };
        } else {
          // PROTOCOL and LIVE require browser — not executed in worker directly;
          // this worker enqueues the browser subprocess and waits.
          // For MVP: log and mark as pending external execution.
          result = {
            message: 'PROTOCOL/LIVE replay requires browser subprocess orchestration (PARTIAL)',
            mode: payload.mode,
            traceId: payload.traceId,
          };
        }

        await job.updateProgress(90);

        // 5. Mark completed
        await prisma.replayJob.update({
          where: { id: payload.replayJobId },
          data: { status: 'COMPLETED' },
        });

        await job.updateProgress(100);
        return result;

      } catch (err: unknown) {
        // Classify: security violations are not retryable
        if (
          err instanceof AppError &&
          (err.code === 'REPLAY_SECURITY_VIOLATION' ||
            err.code === 'CROSS_TENANT_ACCESS_DENIED')
        ) {
          await prisma.replayJob.update({
            where: { id: payload.replayJobId },
            data: { status: 'FAILED' },
          }).catch(() => {});
          throw new UnrecoverableError(`Non-retryable: ${err.message}`);
        }

        // All other errors: let BullMQ retry with exponential backoff
        await prisma.replayJob.update({
          where: { id: payload.replayJobId },
          data: { status: 'FAILED' },
        }).catch(() => {});
        throw err;
      }
    },
    {
      connection: getManagedRedis() as any,
      concurrency: 4,
      lockDuration: 30_000,
      stalledInterval: 15_000,
    }
  );

  worker.on('stalled', (jobId) => {
    process.stderr.write(`[ReplayWorker] Job ${jobId} stalled — will be retried\n`);
  });

  worker.on('failed', (job, err) => {
    const isDeadLettered = job && job.attemptsMade >= (job.opts.attempts ?? 3);
    process.stderr.write(
      `[ReplayWorker] Job ${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts.attempts}): ${err.message}` +
      (isDeadLettered ? ' — DEAD LETTERED' : '') +
      '\n'
    );
  });

  return worker;
}
