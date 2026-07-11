import * as crypto from 'crypto';
import { prisma } from '../../lib/db';
import { AppError } from '../errors/errors';

export type ApiKeyScope =
  | 'TRACE_WRITE'
  | 'ARTIFACT_WRITE'
  | 'TRACE_READ'
  | 'REPLAY_CREATE'
  | 'EXPERIMENT_CREATE';

export class KeyManager {
  /**
   * Generates a new API token, hashes it, and saves it in the database.
   * Returns the plaintext token which must be shown to the user ONLY ONCE.
   */
  static async generateKey(options: {
    projectId: string;
    scope: ApiKeyScope;
    environmentScope?: string;
    expiresInDays?: number;
  }): Promise<{ plaintextKey: string; keyPrefix: string }> {
    const randomBytes = crypto.randomBytes(32).toString('hex');
    const keyPrefix = `le_${options.scope.toLowerCase()}_`;
    const plaintextKey = `${keyPrefix}${randomBytes}`;

    // Hash key using SHA-256
    const hashedKey = crypto.createHash('sha256').update(plaintextKey).digest('hex');

    const expiresAt = options.expiresInDays
      ? new Date(Date.now() + options.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    await prisma.ingestionKey.create({
      data: {
        projectId: options.projectId,
        keyPrefix,
        hashedKey,
        scope: options.scope,
        environmentScope: options.environmentScope || null,
        expiresAt,
      },
    });

    return { plaintextKey, keyPrefix };
  }

  /**
   * Verifies an incoming API key against stored database hashes.
   * Updates last-used timestamp on successful validation.
   * Throws timing-safe, indistinguishable errors on failure.
   */
  static async verifyKey(options: {
    plaintextKey: string;
    requiredScope?: ApiKeyScope;
    requiredEnvironment?: string;
  }): Promise<{ projectId: string; workspaceId: string; scope: ApiKeyScope; environmentScope?: string }> {
    const rawKey = options.plaintextKey || '';
    const isValidFormat = rawKey.startsWith('le_');

    // To prevent timing attacks, always hash the key (or a dummy key)
    const keyToHash = isValidFormat ? rawKey : 'le_dummykeyforconstanttimecomparison';
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

    // Timing-safe constant-time comparison buffer
    const inputBuf = Buffer.from(hashedKey, 'hex');
    const compareBuf = Buffer.from(
      keyRecord?.hashedKey || 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      'hex'
    );
    const isMatch = crypto.timingSafeEqual(inputBuf, compareBuf);

    // Indistinguishable auth failure helper (prevents logging raw keys)
    const fail = () => {
      return new AppError({
        code: 'AUTHENTICATION_FAILED',
        message: 'Unauthorized: Invalid or expired API key',
        status: 401,
      });
    };

    if (!isValidFormat || !keyRecord || !isMatch) {
      throw fail();
    }

    if (keyRecord.revokedAt) {
      throw fail();
    }

    if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) {
      throw fail();
    }

    // Scope check
    if (options.requiredScope && keyRecord.scope !== options.requiredScope) {
      throw fail();
    }

    // Environment check
    if (
      options.requiredEnvironment &&
      keyRecord.environmentScope &&
      keyRecord.environmentScope !== options.requiredEnvironment
    ) {
      throw fail();
    }

    // Update last-used timestamp asynchronously
    prisma.ingestionKey
      .update({
        where: { id: keyRecord.id },
        data: { lastUsedAt: new Date() },
      })
      .catch((e: any) => {
        process.stderr.write(`[KeyManager] Failed to update lastUsedAt: ${e.message}\n`);
      });

    return {
      projectId: keyRecord.projectId,
      workspaceId: keyRecord.project.workspaceId,
      scope: keyRecord.scope as ApiKeyScope,
      environmentScope: keyRecord.environmentScope || undefined,
    };
  }

  /**
   * Rotates a key by revoking the old key and generating a new one with the same config.
   */
  static async rotateKey(options: {
    oldPlaintextKey: string;
    expiresInDays?: number;
  }): Promise<{ plaintextKey: string; keyPrefix: string }> {
    // 1. Verify old key without scope restriction to retrieve its context
    const context = await this.verifyKey({
      plaintextKey: options.oldPlaintextKey,
    });

    const hashedKey = crypto.createHash('sha256').update(options.oldPlaintextKey).digest('hex');

    // Revoke old key
    await prisma.ingestionKey.update({
      where: { hashedKey },
      data: { revokedAt: new Date() },
    });

    // Generate new key with same project, scope, and environment
    return this.generateKey({
      projectId: context.projectId,
      scope: context.scope,
      environmentScope: context.environmentScope,
      expiresInDays: options.expiresInDays,
    });
  }
}
