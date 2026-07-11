import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../../lib/db';
import { processRetentionJob } from '../queue/workers/retentionWorker';
import { getArtifactStore } from '../artifacts/store';

describe('Retention and Deletion Sweeps Suite', () => {
  let projectId: string;
  let workspaceId: string;
  let agentId: string;
  let agentVersionId: string;
  let environmentId: string;
  let store: any;

  beforeAll(async () => {
    // 1. Setup workspace and project
    const workspace = await prisma.workspace.create({
      data: { name: 'Retention Test Workspace' },
    });
    workspaceId = workspace.id;

    const project = await prisma.project.create({
      data: { name: 'Retention Project', workspaceId },
    });
    projectId = project.id;

    const env = await prisma.environment.create({
      data: { name: 'DEVELOPMENT', projectId },
    });
    environmentId = env.id;

    const agent = await prisma.agent.create({
      data: { name: 'Test Agent', projectId },
    });
    agentId = agent.id;

    const agentVer = await prisma.agentVersion.create({
      data: { version: '1.0.0', agentId, promptSchema: '{}' },
    });
    agentVersionId = agentVer.id;

    store = getArtifactStore();
  });

  afterAll(async () => {
    // Cleanup workspace
    await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
  });

  it('should clean up old traces and delete associated binary files from disk', async () => {
    const traceId = `trace_${Date.now()}`;

    // Create an old trace (simulating historical data)
    const trace = await prisma.trace.create({
      data: {
        id: traceId,
        status: 'SUCCESS',
        projectId,
        agentId,
        agentVersionId,
        environmentId,
        userInput: 'test retention',
        sessionId: 'session_retention',
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days old
      },
    });

    const session = await prisma.browserSession.create({
      data: {
        traceId: trace.id,
        browserVersion: 'chrome-110',
      },
    });

    // Create a local artifact file
    const fileContent = Buffer.from('Retention binary test content');
    const artifact = await store.put(
      { projectId, workspaceId },
      {
        browserSessionId: session.id,
        name: 'test_retention.txt',
        mimeType: 'text/plain',
        buffer: fileContent,
      }
    );

    // Verify artifact file exists on disk
    expect(fs.existsSync(artifact.filePath)).toBe(true);

    const job = {
      data: {
        _version: 1,
        jobId: require('crypto').randomUUID(),
        sweepType: 'trace',
        retentionDays: 5,
        dryRun: false,
      },
      updateProgress: async () => {},
    } as any;

    const res = await processRetentionJob(job);
    expect(res.deletedCount).toBeGreaterThanOrEqual(1);

    // Verify trace is deleted from database
    const dbTrace = await prisma.trace.findUnique({ where: { id: traceId } });
    expect(dbTrace).toBeNull();

    // Verify artifact metadata is deleted from database (via cascade or manual sweeps)
    const dbArtifact = await prisma.traceArtifact.findUnique({ where: { id: artifact.id } });
    expect(dbArtifact).toBeNull();

    // Verify binary file is unlinked from filesystem
    expect(fs.existsSync(artifact.filePath)).toBe(false);
  });
});
