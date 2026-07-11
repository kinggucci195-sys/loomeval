import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Readable } from 'stream';
import { prisma } from '../../lib/db';

export interface ArtifactInput {
  browserSessionId: string;
  stepId?: string;
  name: string;
  mimeType: string;
  buffer: Buffer;
  isSensitive?: boolean;
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
  put(input: ArtifactInput): Promise<StoredArtifact>;
  open(id: string): Promise<Readable>;
  delete(id: string): Promise<void>;
}

export class LocalArtifactStore implements ArtifactStore {
  private baseDir: string;

  constructor(customBaseDir?: string) {
    // Store outside the Next.js workspace directory (publicly served dirs) by default
    this.baseDir = customBaseDir || path.resolve(process.cwd(), '../.loomeval-artifacts');
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * Safe path resolution to prevent path traversal vulnerability.
   */
  private resolveSafePath(filename: string): string {
    const resolvedPath = path.resolve(this.baseDir, filename);
    if (!resolvedPath.startsWith(this.baseDir)) {
      throw new Error('Access denied: Path traversal detected');
    }
    return resolvedPath;
  }

  async put(input: ArtifactInput): Promise<StoredArtifact> {
    // Prevent path traversal on user-supplied filename
    if (input.name.includes('..') || path.isAbsolute(input.name)) {
      throw new Error('Access denied: Path traversal detected');
    }

    const id = crypto.randomUUID();
    const sha256 = crypto.createHash('sha256').update(input.buffer).digest('hex');
    const fileSize = input.buffer.length;

    // Use UUID-based filename rather than trusting input filename
    const fileExt = path.extname(input.name) || '.bin';
    const storageFilename = `${id}${fileExt}`;
    const filePath = this.resolveSafePath(storageFilename);

    // Save buffer to secure directory
    fs.writeFileSync(filePath, input.buffer);

    // Save metadata record transactionally
    const artifact = await prisma.traceArtifact.create({
      data: {
        id,
        browserSessionId: input.browserSessionId,
        stepId: input.stepId || null,
        name: input.name,
        mimeType: input.mimeType,
        fileSize,
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
  }

  async open(id: string): Promise<Readable> {
    const artifact = await prisma.traceArtifact.findUnique({
      where: { id },
    });

    if (!artifact) {
      throw new Error('Artifact not found');
    }

    const filePath = this.resolveSafePath(path.basename(artifact.filePath));
    if (!fs.existsSync(filePath)) {
      throw new Error('Artifact file missing on disk');
    }

    return fs.createReadStream(filePath);
  }

  async delete(id: string): Promise<void> {
    const artifact = await prisma.traceArtifact.findUnique({
      where: { id },
    });

    if (!artifact) return;

    const filePath = this.resolveSafePath(path.basename(artifact.filePath));
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await prisma.traceArtifact.delete({
      where: { id },
    });
  }
}
