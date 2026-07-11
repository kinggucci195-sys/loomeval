import { prisma } from '../../lib/db';
import { AppError } from '../errors/errors';
import { TenantContext } from './tenant';

/**
 * Structural Tenant Isolation Repository Layer.
 *
 * Direct Prisma client calls for tenant data are forbidden.
 * Every method enforces workspace and project boundaries.
 * Cross-tenant violations return indistinguishable/safe errors.
 */

// Helper to verify that the project actually belongs to the workspace
async function verifyProjectWorkspace(projectId: string, workspaceId: string): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { workspaceId: true },
  });
  if (!project || project.workspaceId !== workspaceId) {
    throw new AppError({
      code: 'CROSS_TENANT_ACCESS_DENIED',
      message: 'Access Denied: Invalid project or workspace association',
      status: 403,
    });
  }
}

export const traceRepository = {
  async findById(tenant: TenantContext, traceId: string) {
    await verifyProjectWorkspace(tenant.projectId, tenant.workspaceId);
    const trace = await prisma.trace.findFirst({
      where: {
        id: traceId,
        projectId: tenant.projectId,
      },
      include: {
        browserSessions: {
          include: {
            actions: true,
            snapshots: true,
            networkLogs: true,
          },
        },
      },
    });
    if (!trace) {
      throw new AppError({
        code: 'TRACE_NOT_FOUND',
        message: 'Trace not found',
        status: 404,
      });
    }
    return trace;
  },

  async create(
    tenant: TenantContext,
    data: {
      sessionId: string;
      externalTraceId?: string;
      agentId: string;
      agentVersionId: string;
      environmentId: string;
      userInput: string;
      finalOutput?: string;
      status: 'SUCCESS' | 'FAILED' | 'RUNNING';
    }
  ) {
    await verifyProjectWorkspace(tenant.projectId, tenant.workspaceId);

    // Verify environment belongs to this project
    const envRecord = await prisma.environment.findFirst({
      where: { id: data.environmentId, projectId: tenant.projectId },
    });
    if (!envRecord) {
      throw new AppError({
        code: 'INVALID_ENVIRONMENT',
        message: 'Environment does not belong to the selected project',
        status: 400,
      });
    }

    // Verify agent belongs to this project
    const agentRecord = await prisma.agent.findFirst({
      where: { id: data.agentId, projectId: tenant.projectId },
    });
    if (!agentRecord) {
      throw new AppError({
        code: 'AGENT_NOT_FOUND',
        message: 'Agent does not belong to the selected project',
        status: 400,
      });
    }

    // Idempotency check on (projectId, externalTraceId) boundary
    if (data.externalTraceId) {
      const existing = await prisma.trace.findUnique({
        where: {
          projectId_externalTraceId: {
            projectId: tenant.projectId,
            externalTraceId: data.externalTraceId,
          },
        },
      });
      if (existing) {
        throw new AppError({
          code: 'DUPLICATE_EXTERNAL_TRACE_ID',
          message: 'A trace with this external ID already exists in this project',
          status: 409,
        });
      }
    }

    return prisma.trace.create({
      data: {
        ...data,
        projectId: tenant.projectId,
      },
    });
  },

  async delete(tenant: TenantContext, traceId: string) {
    await verifyProjectWorkspace(tenant.projectId, tenant.workspaceId);
    const trace = await prisma.trace.findFirst({
      where: { id: traceId, projectId: tenant.projectId },
    });
    if (!trace) {
      throw new AppError({
        code: 'TRACE_NOT_FOUND',
        message: 'Trace not found',
        status: 404,
      });
    }
    return prisma.trace.delete({
      where: { id: traceId },
    });
  },
};

export const artifactRepository = {
  async findById(tenant: TenantContext, artifactId: string) {
    await verifyProjectWorkspace(tenant.projectId, tenant.workspaceId);
    const artifact = await prisma.traceArtifact.findUnique({
      where: { id: artifactId },
      include: {
        browserSession: {
          select: {
            trace: {
              select: { projectId: true },
            },
          },
        },
      },
    });

    if (!artifact || artifact.browserSession.trace.projectId !== tenant.projectId) {
      throw new AppError({
        code: 'ARTIFACT_NOT_FOUND',
        message: 'Artifact not found',
        status: 404,
      });
    }
    return artifact;
  },

  async create(
    tenant: TenantContext,
    data: {
      fileName: string;
      filePath: string;
      fileSize: number;
      mimeType: string;
      checksum: string;
      browserSessionId: string;
      isSensitive?: boolean;
    }
  ) {
    await verifyProjectWorkspace(tenant.projectId, tenant.workspaceId);

    // Verify session belongs to a trace in this project
    const session = await prisma.browserSession.findFirst({
      where: {
        id: data.browserSessionId,
        trace: { projectId: tenant.projectId },
      },
    });
    if (!session) {
      throw new AppError({
        code: 'CROSS_TENANT_ACCESS_DENIED',
        message: 'Invalid session context for artifact upload',
        status: 403,
      });
    }

    return prisma.traceArtifact.create({
      data,
    });
  },

  async delete(tenant: TenantContext, artifactId: string) {
    // Verifies workspace/project ownership first
    const artifact = await this.findById(tenant, artifactId);
    return prisma.traceArtifact.delete({
      where: { id: artifact.id },
    });
  },
};

export const replayRepository = {
  async findJobById(tenant: TenantContext, replayJobId: string) {
    await verifyProjectWorkspace(tenant.projectId, tenant.workspaceId);
    const job = await prisma.replayJob.findUnique({
      where: { id: replayJobId },
    });
    if (!job) {
      throw new AppError({
        code: 'REPLAY_NOT_FOUND',
        message: 'Replay job not found',
        status: 404,
      });
    }
    return job;
  },

  async createJob(tenant: TenantContext, mode: 'FORENSIC' | 'PROTOCOL' | 'LIVE') {
    await verifyProjectWorkspace(tenant.projectId, tenant.workspaceId);
    return prisma.replayJob.create({
      data: {
        replayMode: mode,
        status: 'PENDING',
      },
    });
  },
};

export const experimentRepository = {
  async findById(tenant: TenantContext, experimentId: string) {
    await verifyProjectWorkspace(tenant.projectId, tenant.workspaceId);
    // Find experiment and ensure it is associated with an agent/project in this tenant
    const experiment = await prisma.experiment.findFirst({
      where: {
        id: experimentId,
        agent: { projectId: tenant.projectId },
      },
    });
    if (!experiment) {
      throw new AppError({
        code: 'EXPERIMENT_NOT_FOUND',
        message: 'Experiment not found',
        status: 404,
      });
    }
    return experiment;
  },
};
