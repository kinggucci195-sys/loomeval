import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../lib/db';
import { KeyManager } from '../security/keys';

describe('API Key Authentication Hardening Suite', () => {
  let projectId: string;
  let workspaceId: string;

  beforeAll(async () => {
    const workspace = await prisma.workspace.create({
      data: { name: 'Auth Test Workspace' },
    });
    workspaceId = workspace.id;

    const project = await prisma.project.create({
      data: { name: 'Auth Project', workspaceId },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
  });

  it('should generate scoped keys and verify them successfully', async () => {
    const { plaintextKey } = await KeyManager.generateKey({
      projectId,
      scope: 'TRACE_WRITE',
      environmentScope: 'production',
    });

    expect(plaintextKey).toMatch(/^le_trace_write_/);

    const verified = await KeyManager.verifyKey({
      plaintextKey,
      requiredScope: 'TRACE_WRITE',
      requiredEnvironment: 'production',
    });

    expect(verified.projectId).toBe(projectId);
    expect(verified.workspaceId).toBe(workspaceId);
    expect(verified.scope).toBe('TRACE_WRITE');
    expect(verified.environmentScope).toBe('production');
  });

  it('should reject missing or invalid formats with indistinguishable errors', async () => {
    await expect(
      KeyManager.verifyKey({ plaintextKey: '' })
    ).rejects.toThrow(/Unauthorized: Invalid or expired API key/);

    await expect(
      KeyManager.verifyKey({ plaintextKey: 'malformed_key_123' })
    ).rejects.toThrow(/Unauthorized: Invalid or expired API key/);
  });

  it('should reject expired keys', async () => {
    const { plaintextKey } = await KeyManager.generateKey({
      projectId,
      scope: 'TRACE_WRITE',
      expiresInDays: -1, // Expired yesterday
    });

    await expect(
      KeyManager.verifyKey({ plaintextKey })
    ).rejects.toThrow(/Unauthorized: Invalid or expired API key/);
  });

  it('should reject revoked keys', async () => {
    const { plaintextKey } = await KeyManager.generateKey({
      projectId,
      scope: 'TRACE_WRITE',
    });

    // Revoke key
    const hashedKey = require('crypto').createHash('sha256').update(plaintextKey).digest('hex');
    await prisma.ingestionKey.update({
      where: { hashedKey },
      data: { revokedAt: new Date() },
    });

    await expect(
      KeyManager.verifyKey({ plaintextKey })
    ).rejects.toThrow(/Unauthorized: Invalid or expired API key/);
  });

  it('should reject requests with incorrect scope', async () => {
    const { plaintextKey } = await KeyManager.generateKey({
      projectId,
      scope: 'TRACE_READ',
    });

    await expect(
      KeyManager.verifyKey({
        plaintextKey,
        requiredScope: 'TRACE_WRITE', // Wrong scope
      })
    ).rejects.toThrow(/Unauthorized: Invalid or expired API key/);
  });

  it('should support timing-safe rotation', async () => {
    const { plaintextKey: oldKey } = await KeyManager.generateKey({
      projectId,
      scope: 'TRACE_WRITE',
      environmentScope: 'production',
    });

    const { plaintextKey: newKey } = await KeyManager.rotateKey({
      oldPlaintextKey: oldKey,
    });

    expect(newKey).not.toBe(oldKey);
    expect(newKey).toMatch(/^le_trace_write_/);

    // Old key must be revoked now
    await expect(
      KeyManager.verifyKey({ plaintextKey: oldKey })
    ).rejects.toThrow(/Unauthorized: Invalid or expired API key/);

    // New key must be valid
    const verified = await KeyManager.verifyKey({ plaintextKey: newKey });
    expect(verified.projectId).toBe(projectId);
  });
});
