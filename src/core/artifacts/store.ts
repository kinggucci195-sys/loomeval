import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Readable } from 'stream';
import { prisma } from '../../lib/db';
import { TenantContext } from '../security/tenant';
import { AppError } from '../errors/errors';
import { env } from '../config/env';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface ArtifactInput {
  browserSessionId: string;
  stepId?: string;
  name: string;
  mimeType: string;
  buffer: Buffer;
  isSensitive?: boolean;
  expectedChecksum?: string;
}

export interface StoredArtifact {
  id: string;
  name: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
  filePath: string;
  isSensitive: boolean;
}

export interface ArtifactStore {
  put(tenant: TenantContext, input: ArtifactInput): Promise<StoredArtifact>;
  open(tenant: TenantContext, id: string): Promise<Readable>;
  delete(tenant: TenantContext, id: string): Promise<void>;
  getPresignedUrl?(tenant: TenantContext, id: string): Promise<string>;
}

// ── Validation Constants ─────────────────────────────────────────────────────
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit
const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/html',
  'text/plain',
  'application/json',
  'application/pdf',
  'application/octet-stream',
]);

function validateArtifactInput(input: ArtifactInput) {
  // 1. Path traversal check on input filename
  const filename = path.basename(input.name);
  if (input.name !== filename || input.name.includes('..') || path.isAbsolute(input.name)) {
    throw new AppError({
      code: 'ARTIFACT_PATH_TRAVERSAL',
      message: 'Access denied: Path traversal detected in artifact name',
      status: 400,
    });
  }

  // 2. Maximum size check
  if (input.buffer.length > MAX_FILE_SIZE) {
    throw new AppError({
      code: 'PAYLOAD_TOO_LARGE',
      message: `Artifact size exceeds limit of ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
      status: 400,
    });
  }

  // 3. MIME allow-list validation
  if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
    throw new AppError({
      code: 'UNSUPPORTED_MIME_TYPE',
      message: `Disallowed MIME type: ${input.mimeType}`,
      status: 400,
    });
  }

  // 4. SHA-256 verification
  const calculatedSha256 = crypto.createHash('sha256').update(input.buffer).digest('hex');
  if (input.expectedChecksum && input.expectedChecksum !== calculatedSha256) {
    throw new AppError({
      code: 'CHECKSUM_MISMATCH',
      message: 'Artifact checksum validation failed',
      status: 400,
    });
  }

  return calculatedSha256;
}

// ── Local Filesystem Adapter ──────────────────────────────────────────────────
export class LocalArtifactStore implements ArtifactStore {
  private baseDir: string;

  constructor(customBaseDir?: string) {
    this.baseDir = path.resolve(customBaseDir || path.resolve(process.cwd(), '../.loomeval-artifacts'));
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private resolveSafePath(tenant: TenantContext, filename: string): string {
    // Isolate path structurally under tenant-scoped directories
    const tenantDir = path.join(this.baseDir, tenant.workspaceId || 'default-workspace', tenant.projectId || 'default-project');
    if (!fs.existsSync(tenantDir)) {
      fs.mkdirSync(tenantDir, { recursive: true });
    }
    const resolvedPath = path.resolve(tenantDir, filename);
    if (!resolvedPath.startsWith(this.baseDir)) {
      throw new AppError({
        code: 'ARTIFACT_PATH_TRAVERSAL',
        message: 'Access denied: Path traversal detected',
        status: 400,
      });
    }
    return resolvedPath;
  }

  async put(tenantOrInput: TenantContext | ArtifactInput, maybeInput?: ArtifactInput): Promise<StoredArtifact> {
    let tenant: TenantContext;
    let input: ArtifactInput;

    if (maybeInput) {
      tenant = tenantOrInput as TenantContext;
      input = maybeInput;
    } else {
      input = tenantOrInput as ArtifactInput;
      tenant = { projectId: 'default-project', workspaceId: 'default-workspace' };
    }

    const sha256 = validateArtifactInput(input);

    // Verify session belongs to tenant (if not fallback)
    if (tenant.projectId !== 'default-project') {
      const session = await prisma.browserSession.findFirst({
        where: { id: input.browserSessionId, trace: { projectId: tenant.projectId } },
      });
      if (!session) {
        throw new AppError({
          code: 'CROSS_TENANT_ACCESS_DENIED',
          message: 'Browser session does not belong to the selected tenant context',
          status: 403,
        });
      }
    }

    const id = crypto.randomUUID();
    const fileExt = path.extname(input.name) || '.bin';
    const storageFilename = `${id}${fileExt}`;
    const filePath = this.resolveSafePath(tenant, storageFilename);

    try {
      fs.writeFileSync(filePath, input.buffer);
    } catch (err) {
      throw new AppError({
        code: 'ARTIFACT_STORE_ERROR',
        message: 'Failed to write artifact to filesystem',
        cause: err,
      });
    }

    try {
      const artifact = await prisma.traceArtifact.create({
        data: {
          id,
          browserSessionId: input.browserSessionId,
          stepId: input.stepId || null,
          name: input.name,
          mimeType: input.mimeType,
          fileSize: input.buffer.length,
          sha256,
          filePath,
          isSensitive: !!input.isSensitive,
        },
      });

      return {
        id: artifact.id,
        name: artifact.name,
        mimeType: artifact.mimeType,
        fileSize: artifact.fileSize,
        sha256: artifact.sha256,
        filePath: artifact.filePath,
        isSensitive: artifact.isSensitive,
      };
    } catch (dbErr) {
      // Partial write cleanup
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      throw dbErr;
    }
  }

  async open(tenantOrId: TenantContext | string, maybeId?: string): Promise<Readable> {
    let tenant: TenantContext;
    let id: string;
    if (maybeId) {
      tenant = tenantOrId as TenantContext;
      id = maybeId;
    } else {
      id = tenantOrId as string;
      tenant = { projectId: 'default-project', workspaceId: 'default-workspace' };
    }

    const artifact = await prisma.traceArtifact.findUnique({
      where: { id },
      include: { browserSession: { include: { trace: true } } },
    });

    if (!artifact || (tenant.projectId !== 'default-project' && artifact.browserSession.trace.projectId !== tenant.projectId)) {
      throw new AppError({
        code: 'ARTIFACT_NOT_FOUND',
        message: 'Artifact not found',
        status: 404,
      });
    }

    const storageFilename = path.basename(artifact.filePath);
    const filePath = this.resolveSafePath(tenant, storageFilename);
    if (!fs.existsSync(filePath)) {
      throw new AppError({
        code: 'ARTIFACT_STORE_ERROR',
        message: 'Artifact file missing on disk',
        status: 500,
      });
    }

    return fs.createReadStream(filePath);
  }

  async delete(tenantOrId: TenantContext | string, maybeId?: string): Promise<void> {
    let tenant: TenantContext;
    let id: string;
    if (maybeId) {
      tenant = tenantOrId as TenantContext;
      id = maybeId;
    } else {
      id = tenantOrId as string;
      tenant = { projectId: 'default-project', workspaceId: 'default-workspace' };
    }

    const artifact = await prisma.traceArtifact.findUnique({
      where: { id },
      include: { browserSession: { include: { trace: true } } },
    });

    if (!artifact || (tenant.projectId !== 'default-project' && artifact.browserSession.trace.projectId !== tenant.projectId)) {
      throw new AppError({
        code: 'ARTIFACT_NOT_FOUND',
        message: 'Artifact not found',
        status: 404,
      });
    }

    const storageFilename = path.basename(artifact.filePath);
    const filePath = this.resolveSafePath(tenant, storageFilename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await prisma.traceArtifact.delete({
      where: { id },
    });
  }
}

// ── S3 Compatible Storage Adapter ─────────────────────────────────────────────
export class S3ArtifactStore implements ArtifactStore {
  private client: S3Client;
  private bucket: string;

  constructor() {
    this.bucket = env.S3_BUCKET || 'loomeval-artifacts';
    this.client = new S3Client({
      region: env.S3_REGION || 'us-east-1',
      endpoint: env.S3_ENDPOINT || undefined,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID || 'dummy',
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY || 'dummy',
      },
      maxAttempts: 3,
    });
  }

  private getObjectKey(tenant: TenantContext, id: string, originalName: string): string {
    const ext = path.extname(originalName) || '.bin';
    // Safe structure: workspaces/<workspaceId>/projects/<projectId>/artifacts/<id><ext>
    return `workspaces/${tenant.workspaceId}/projects/${tenant.projectId}/artifacts/${id}${ext}`;
  }

  async put(tenant: TenantContext, input: ArtifactInput): Promise<StoredArtifact> {
    const sha256 = validateArtifactInput(input);

    const session = await prisma.browserSession.findFirst({
      where: { id: input.browserSessionId, trace: { projectId: tenant.projectId } },
    });
    if (!session) {
      throw new AppError({
        code: 'CROSS_TENANT_ACCESS_DENIED',
        message: 'Browser session does not belong to the selected tenant context',
        status: 403,
      });
    }

    const id = crypto.randomUUID();
    const objectKey = this.getObjectKey(tenant, id, input.name);

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
          Body: input.buffer,
          ContentType: input.mimeType,
          ServerSideEncryption: 'AES256',
        })
      );
    } catch (err) {
      throw new AppError({
        code: 'ARTIFACT_STORE_ERROR',
        message: 'Failed to upload artifact to S3 storage provider',
        cause: err,
      });
    }

    try {
      const artifact = await prisma.traceArtifact.create({
        data: {
          id,
          browserSessionId: input.browserSessionId,
          stepId: input.stepId || null,
          name: input.name,
          mimeType: input.mimeType,
          fileSize: input.buffer.length,
          sha256,
          filePath: objectKey,
          isSensitive: !!input.isSensitive,
        },
      });

      return {
        id: artifact.id,
        name: artifact.name,
        mimeType: artifact.mimeType,
        fileSize: artifact.fileSize,
        sha256: artifact.sha256,
        filePath: artifact.filePath,
        isSensitive: artifact.isSensitive,
      };
    } catch (dbErr) {
      // Failure cleanup: remove from S3 if DB record creation failed
      await this.client
        .send(
          new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: objectKey,
          })
        )
        .catch((e) => {
          process.stderr.write(`[S3Store] Failed to clean up orphan object key ${objectKey}: ${e.message}\n`);
        });
      throw dbErr;
    }
  }

  async open(tenant: TenantContext, id: string): Promise<Readable> {
    const artifact = await prisma.traceArtifact.findUnique({
      where: { id },
      include: { browserSession: { include: { trace: true } } },
    });

    if (!artifact || artifact.browserSession.trace.projectId !== tenant.projectId) {
      throw new AppError({
        code: 'ARTIFACT_NOT_FOUND',
        message: 'Artifact not found',
        status: 404,
      });
    }

    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: artifact.filePath,
        })
      );
      if (res.Body instanceof Readable) {
        return res.Body;
      }
      // Handle web environments / node buffers
      const bytes = await res.Body?.transformToByteArray();
      if (!bytes) {
        throw new Error('S3 object payload is empty');
      }
      return Readable.from(Buffer.from(bytes));
    } catch (err) {
      throw new AppError({
        code: 'ARTIFACT_STORE_ERROR',
        message: 'Failed to retrieve object from S3 storage provider',
        cause: err,
      });
    }
  }

  async delete(tenant: TenantContext, id: string): Promise<void> {
    const artifact = await prisma.traceArtifact.findUnique({
      where: { id },
      include: { browserSession: { include: { trace: true } } },
    });

    if (!artifact || artifact.browserSession.trace.projectId !== tenant.projectId) {
      throw new AppError({
        code: 'ARTIFACT_NOT_FOUND',
        message: 'Artifact not found',
        status: 404,
      });
    }

    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: artifact.filePath,
        })
      );
    } catch (err) {
      throw new AppError({
        code: 'ARTIFACT_STORE_ERROR',
        message: 'Failed to delete object from S3 storage provider',
        cause: err,
      });
    }

    await prisma.traceArtifact.delete({
      where: { id },
    });
  }

  async getPresignedUrl(tenant: TenantContext, id: string): Promise<string> {
    const artifact = await prisma.traceArtifact.findUnique({
      where: { id },
      include: { browserSession: { include: { trace: true } } },
    });

    if (!artifact || artifact.browserSession.trace.projectId !== tenant.projectId) {
      throw new AppError({
        code: 'ARTIFACT_NOT_FOUND',
        message: 'Artifact not found',
        status: 404,
      });
    }

    try {
      return getSignedUrl(
        this.client,
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: artifact.filePath,
        }),
        { expiresIn: 3600 } // 1 hour expiration
      );
    } catch (err) {
      throw new AppError({
        code: 'ARTIFACT_STORE_ERROR',
        message: 'Failed to generate S3 presigned URL',
        cause: err,
      });
    }
  }
}

export function getArtifactStore(): ArtifactStore {
  if (env.ARTIFACT_STORE_TYPE === 's3') {
    return new S3ArtifactStore();
  }
  return new LocalArtifactStore(env.ARTIFACT_LOCAL_PATH);
}
