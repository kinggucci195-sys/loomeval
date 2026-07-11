import * as crypto from 'crypto';
import { prisma } from '../../lib/db';

export class KeyManager {
  /**
   * Generates a new API token, hashes it, and saves it in the database.
   * Returns the plaintext token which must be shown to the user ONLY ONCE.
   */
  static async generateKey(
    projectId: string,
    scope: 'INGEST' | 'READ' | 'ADMIN' = 'INGEST',
    expiresInDays?: number
  ): Promise<{ plaintextKey: string; keyPrefix: string }> {
    const randomBytes = crypto.randomBytes(24).toString('hex');
    const keyPrefix = `le_${scope.toLowerCase()}_`;
    const plaintextKey = `${keyPrefix}${randomBytes}`;
    
    // Hash key using SHA-256
    const hashedKey = crypto.createHash('sha256').update(plaintextKey).digest('hex');

    const expiresAt = expiresInDays 
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) 
      : null;

    await prisma.ingestionKey.create({
      data: {
        projectId,
        keyPrefix,
        hashedKey,
        scope,
        expiresAt,
      },
    });

    return { plaintextKey, keyPrefix };
  }

  /**
   * Verifies an incoming API key against stored database hashes.
   * Returns the project metadata if valid, throws an error if invalid.
   */
  static async verifyKey(plaintextKey: string): Promise<{ projectId: string; workspaceId: string; scope: string }> {
    const isValidFormat = plaintextKey && plaintextKey.startsWith('le_');
    const keyToHash = isValidFormat ? plaintextKey : 'le_dummykeyforconstanttimecomparison';
    const hashedKey = crypto.createHash('sha256').update(keyToHash).digest('hex');

    const keyRecord = isValidFormat
      ? await prisma.ingestionKey.findUnique({
          where: { hashedKey },
          include: {
            project: {
              select: {
                id: true,
                workspaceId: true,
              },
            },
          },
        })
      : null;

    const inputBuf = Buffer.from(hashedKey, 'hex');
    const compareBuf = Buffer.from(keyRecord?.hashedKey || 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'hex');
    const isMatch = crypto.timingSafeEqual(inputBuf, compareBuf);

    if (!isValidFormat || !keyRecord || !isMatch) {
      throw new Error('Unauthorized: Invalid or expired API key');
    }

    if (keyRecord.revokedAt) {
      throw new Error('Unauthorized: Invalid or expired API key');
    }

    if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) {
      throw new Error('Unauthorized: Invalid or expired API key');
    }

    return {
      projectId: keyRecord.projectId,
      workspaceId: keyRecord.project.workspaceId,
      scope: keyRecord.scope,
    };
  }

  /**
   * Rotates an existing key by verifying, revoking it, and generating a new key with same scope and project.
   */
  static async rotateKey(
    oldPlaintextKey: string,
    expiresInDays?: number
  ): Promise<{ plaintextKey: string; keyPrefix: string }> {
    // 1. Verify the old key using our secure verification logic
    const context = await this.verifyKey(oldPlaintextKey);

    const hashedKey = crypto.createHash('sha256').update(oldPlaintextKey).digest('hex');
    
    // Revoke old key
    await prisma.ingestionKey.update({
      where: { hashedKey },
      data: { revokedAt: new Date() },
    });

    // Generate new key
    const newKey = await this.generateKey(
      context.projectId,
      context.scope as 'INGEST' | 'READ' | 'ADMIN',
      expiresInDays
    );

    return newKey;
  }
}
