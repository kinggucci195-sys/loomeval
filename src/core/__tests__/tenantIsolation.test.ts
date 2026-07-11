import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../lib/db';
import { traceRepository, artifactRepository } from '../security/repository';
import { AppError } from '../errors/errors';

describe('Structural Tenant Isolation Suite', () => {
  let workspaceAId: string;
  let workspaceBId: string;
  let projectAId: string;
  let projectBId: string;
  let envAId: string;
  let envBId: string;
  let agentAId: string;
  let agentAVerId: string;
  let traceAId: string;

  beforeAll(async () => {
    // Workspace A Setup
    const wsA = await prisma.workspace.create({ data: { name: 'Tenant Workspace A' } });
    workspaceAId = wsA.id;
    const projA = await prisma.project.create({ data: { name: 'Project A', workspaceId: workspaceAId } });
    projectAId = projA.id;
    const envA = await prisma.environment.create({ data: { name: 'DEVELOPMENT', projectId: projectAId } });
    envAId = envA.id;
    const agentA = await prisma.agent.create({ data: { name: 'Agent A', projectId: projectAId } });
    agentAId = agentA.id;
    const agentAVer = await prisma.agentVersion.create({ data: { version: '1.0.0', agentId: agentAId, promptSchema: '{}' } });
    agentAVerId = agentAVer.id;

    // Workspace B Setup
    const wsB = await prisma.workspace.create({ data: { name: 'Tenant Workspace B' } });
    workspaceBId = wsB.id;
    const projB = await prisma.project.create({ data: { name: 'Project B', workspaceId: workspaceBId } });
    projectBId = projB.id;
    const envB = await prisma.environment.create({ data: { name: 'DEVELOPMENT', projectId: projectBId } });
    envBId = envB.id;

    // Create a trace in Workspace A
    const traceA = await prisma.trace.create({
      data: {
        status: 'SUCCESS',
        projectId: projectAId,
        agentId: agentAId,
        agentVersionId: agentAVerId,
        environmentId: envAId,
        userInput: 'test tenant isolation',
        sessionId: 'session_tenant_a',
      },
    });
    traceAId = traceA.id;
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspaceAId, workspaceBId] } },
    }).catch(() => {});
  });

  it('should block Workspace B from retrieving Workspace A traces', async () => {
    const tenantB = { projectId: projectBId, workspaceId: workspaceBId };

    // Workspace B querying Trace A
    await expect(
      traceRepository.findById(tenantB, traceAId)
    ).rejects.toThrow(/Trace not found/); // Indistinguishable 404
  });

  it('should block Workspace B from deleting Workspace A traces', async () => {
    const tenantB = { projectId: projectBId, workspaceId: workspaceBId };

    await expect(
      traceRepository.delete(tenantB, traceAId)
    ).rejects.toThrow(/Trace not found/);
  });

  it('should block Workspace A from creating a trace with Workspace B environment ID', async () => {
    const tenantA = { projectId: projectAId, workspaceId: workspaceAId };

    await expect(
      traceRepository.create(tenantA, {
        status: 'SUCCESS',
        agentId: agentAId,
        agentVersionId: agentAVerId,
        environmentId: envBId, // Workspace B env
        userInput: 'malicious crossing',
        sessionId: 'session_x',
      })
    ).rejects.toThrow(/Environment does not belong to the selected project/);
  });

  it('should isolate external trace IDs at the project scope', async () => {
    const tenantA = { projectId: projectAId, workspaceId: workspaceAId };
    const tenantB = { projectId: projectBId, workspaceId: workspaceBId };
    const extId = 'ext_unique_123';

    // Ingest on Project A - Should Succeed
    const trace1 = await traceRepository.create(tenantA, {
      status: 'SUCCESS',
      agentId: agentAId,
      agentVersionId: agentAVerId,
      environmentId: envAId,
      userInput: 'first ingest',
      sessionId: 'session_1',
      externalTraceId: extId,
    });
    expect(trace1).toBeDefined();

    // Ingest duplicate on Project A - Should Fail (Conflict)
    await expect(
      traceRepository.create(tenantA, {
        status: 'SUCCESS',
        agentId: agentAId,
        agentVersionId: agentAVerId,
        environmentId: envAId,
        userInput: 'duplicate ingest',
        sessionId: 'session_2',
        externalTraceId: extId,
      })
    ).rejects.toThrow(/A trace with this external ID already exists/);
  });
});
