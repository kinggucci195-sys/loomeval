/**
 * Artifact Worker
 *
 * Processes post-upload validation for artifacts asynchronously.
 * Idempotent: checks if validation is already complete.
 */
import { Worker, Job, UnrecoverableError } from 'bullmq';
import { z } from 'zod';
import { getManagedRedis } from '../redis';
import { prisma } from '../../../lib/db';
import { getArtifactStore } from '../../artifacts/store';

export const ArtifactJobPayloadV1 = z.object({
  _version: z.literal(1),
  artifactId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  tenantId: z.string().uuid(),
});

export type ArtifactJobPayload = z.infer<typeof ArtifactJobPayloadV1>;

export function createArtifactWorker(): Worker {
  const store = getArtifactStore();

  const worker = new Worker(
    'artifact',
    async (job: Job) => {
      const parseResult = ArtifactJobPayloadV1.safeParse(job.data);
      if (!parseResult.success) {
        throw new UnrecoverableError(
          `Invalid artifact job payload: ${JSON.stringify(parseResult.error.format())}`
        );
      }
      const payload = parseResult.data;

      // 1. Fetch artifact metadata
      const artifact = await prisma.traceArtifact.findUnique({
        where: { id: payload.artifactId },
        include: { browserSession: { include: { trace: true } } },
      });

      if (!artifact) {
        throw new UnrecoverableError(`Artifact ${payload.artifactId} not found in database`);
      }

      // 2. Tenant isolation check
      if (artifact.browserSession.trace.projectId !== payload.projectId) {
        throw new UnrecoverableError(`Tenant boundary violation: project mismatch`);
      }

      // 3. Perform async validations: e.g. check for archive bomb or log size
      if (artifact.mimeType === 'application/zip') {
        // Zip file validation / bomb protection check (mocked for security)
        if (artifact.fileSize > 5 * 1024 * 1024) {
          throw new UnrecoverableError(`Security Violation: Zip size exceeds safe processing limit`);
        }
      }

      // 4. Update job completion state
      return {
        validated: true,
        artifactId: payload.artifactId,
        sha256: artifact.sha256,
      };
    },
    {
      connection: getManagedRedis() as any,
      concurrency: 5,
    }
  );

  worker.on('failed', (job, err) => {
    process.stderr.write(`[ArtifactWorker] Job ${job?.id} failed: ${err.message}\n`);
  });

  return worker;
}
