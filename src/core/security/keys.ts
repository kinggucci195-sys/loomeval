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
  static async verifyKey(plaintextKey: string): Promise<{ projectId: string; workspaceId: string }> {
    if (!plaintextKey || !plaintextKey.startsWith('le_')) {
      throw new Error('Invalid key format');
    }

    const hashedKey = crypto.createHash('sha256').update(plaintextKey).digest('hex');

    const keyRecord = await prisma.ingestionKey.findUnique({
      where: { hashedKey },
      include: {
        project: {
          select: {
            id: true,
            workspaceId: true,
          },
        },
      },
    });

    if (!keyRecord) {
      throw new Error('API key not found');
    }

    if (keyRecord.revokedAt) {
      throw new Error('API key has been revoked');
    }

    if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) {
      throw new Error('API key has expired');
    }

    // Update last used timestamp or write audit event in production
    return {
      projectId: keyRecord.projectId,
      workspaceId: keyRecord.project.workspaceId,
    };
  }
}
