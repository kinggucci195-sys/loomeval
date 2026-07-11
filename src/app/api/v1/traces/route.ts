import { NextResponse } from 'next/server';
import { z } from 'zod';
import * as crypto from 'crypto';
import { prisma } from '../../../../lib/db';
import { Redactor } from '../../../../core/security/redactor';
import { KeyManager } from '../../../../core/security/keys';
import { TenantManager } from '../../../../core/security/tenant';

// Ingestion size limit: 10MB
const MAX_PAYLOAD_SIZE = 10 * 1024 * 1024;

const IngestTraceSchema = z.object({
  externalTraceId: z.string().min(1),
  environmentId: z.string().min(1),
  agentVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  userInput: z.string(),
  finalOutput: z.string().optional().nullable(),
  status: z.enum(['SUCCESS', 'FAILED', 'RUNNING']),
  totalCost: z.number().nonnegative().optional().default(0),
  totalLatencyMs: z.number().int().nonnegative().optional().default(0),
  sessionId: z.string().min(1),
  actions: z.array(
    z.object({
      actionType: z.enum(['FILL', 'CLICK', 'REQUEST_HUMAN_APPROVAL', 'SUBMIT', 'STOP', 'NAVIGATE']),
      elementId: z.string().optional().nullable(),
      selector: z.string().optional().nullable(),
      inputValue: z.string().optional().nullable(),
      url: z.string().optional().nullable(),
      timestamp: z.string().optional().nullable(),
    })
  ),
  networkLogs: z.array(
    z.object({
      url: z.string(),
      method: z.string(),
      requestHeaders: z.string(),
      requestBody: z.string().optional().nullable(),
      responseHeaders: z.string(),
      responseBody: z.string().optional().nullable(),
      statusCode: z.number().int(),
      latencyMs: z.number().int().optional().default(0),
      timestamp: z.string().optional().nullable(),
    })
  ).optional().default([]),
});

export async function POST(request: Request) {
  try {
    // 1. Verify Ingestion Key
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or malformed Authorization header' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    let authContext;
    try {
      authContext = await KeyManager.verifyKey(token);
    } catch (err: any) {
      return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
    }

    // Enforce scope rule
    if (authContext.scope !== 'INGEST' && authContext.scope !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized: Invalid or expired API key' }, { status: 401 });
    }

    return await TenantManager.run(
      { projectId: authContext.projectId, workspaceId: authContext.workspaceId },
      async () => {
        // 2. Validate payload size
        const contentLength = request.headers.get('content-length');
        if (contentLength && parseInt(contentLength) > MAX_PAYLOAD_SIZE) {
          return NextResponse.json({ error: 'Payload size exceeds 10MB limit' }, { status: 413 });
        }

        const rawBody = await request.text();
        if (Buffer.byteLength(rawBody) > MAX_PAYLOAD_SIZE) {
          return NextResponse.json({ error: 'Payload size exceeds 10MB limit' }, { status: 413 });
        }

        // Calculate SHA-256 digest of payload for idempotency checking
        const payloadDigest = crypto.createHash('sha256').update(rawBody).digest('hex');

        let body;
        try {
          body = JSON.parse(rawBody);
        } catch (e) {
          return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
        }

        // 3. Zod Schema Validation
        const parsed = IngestTraceSchema.safeParse(body);
        if (!parsed.success) {
          return NextResponse.json(
            { error: 'Validation failed', details: parsed.error.format() },
            { status: 400 }
          );
        }

        const data = parsed.data;

        // 4. Resolve environment and verify it belongs to the authenticated project
        const env = await prisma.environment.findUnique({
          where: { id: data.environmentId },
        });

        if (!env || env.projectId !== authContext.projectId) {
          return NextResponse.json(
            { error: 'Environment not found or does not belong to authorized project' },
            { status: 400 }
          );
        }

        // 5. Idempotency Boundary check: (projectId, externalTraceId)
        const existingTrace = await prisma.trace.findUnique({
          where: {
            projectId_externalTraceId: {
              projectId: authContext.projectId,
              externalTraceId: data.externalTraceId,
            },
          },
        });

        if (existingTrace) {
          if (existingTrace.payloadDigest !== payloadDigest) {
            return NextResponse.json(
              { error: 'Idempotency conflict: A trace with this external ID already exists with a different payload' },
              { status: 409 }
            );
          }
          return NextResponse.json({
            status: 'success',
            traceId: existingTrace.id,
            message: 'Trace already ingested (idempotent)',
          });
        }

        // 6. Apply Server-Side Redaction
        const redactor = new Redactor();
        const redactedActions = data.actions.map(action => ({
          ...action,
          inputValue: action.inputValue ? redactor.redactText(action.inputValue) : null,
        }));

        const redactedNetwork = data.networkLogs.map(log => ({
          ...log,
          requestHeaders: redactor.redactHeaders(log.requestHeaders),
          requestBody: log.requestBody ? redactor.redactText(log.requestBody) : null,
          responseHeaders: redactor.redactHeaders(log.responseHeaders),
          responseBody: log.responseBody ? redactor.redactText(log.responseBody) : null,
        }));

        // Resolve or find agent and version
        const agent = await prisma.agent.findFirst({
          where: { projectId: authContext.projectId },
        });
        if (!agent) {
          return NextResponse.json({ error: 'Project has no registered agent' }, { status: 400 });
        }

        const agentVersion = await prisma.agentVersion.findFirst({
          where: { agentId: agent.id, version: data.agentVersion },
        });
        if (!agentVersion) {
          return NextResponse.json({ error: `Agent version ${data.agentVersion} not found` }, { status: 400 });
        }

        // 7. Persist Trace Transactionally
        let trace;
        try {
          trace = await prisma.$transaction(async (tx: any) => {
            const createdTrace = await tx.trace.create({
              data: {
                sessionId: data.sessionId,
                externalTraceId: data.externalTraceId,
                payloadDigest,
                projectId: authContext.projectId,
                agentId: agent.id,
                agentVersionId: agentVersion.id,
                environmentId: data.environmentId,
                userInput: data.userInput,
                finalOutput: data.finalOutput,
                status: data.status,
                totalCost: data.totalCost,
                totalLatencyMs: data.totalLatencyMs,
              },
            });

            // Create step spans
            for (const action of redactedActions) {
              await tx.traceStep.create({
                data: {
                  traceId: createdTrace.id,
                  name: action.actionType === 'NAVIGATE' ? 'RETRIEVE' : 'TOOL_CALL',
                  status: 'SUCCESS',
                  input: JSON.stringify(action),
                  output: '{}',
                },
              });
            }

            // Create BrowserSession
            const browserSession = await tx.browserSession.create({
              data: {
                traceId: createdTrace.id,
                browserVersion: 'Playwright Browser',
                viewportWidth: 1280,
                viewportHeight: 720,
                userAgent: 'Mozilla/5.0 User Agent',
              },
            });

            // Create BrowserActions
            for (const action of redactedActions) {
              await tx.browserAction.create({
                data: {
                  browserSessionId: browserSession.id,
                  actionType: action.actionType,
                  elementId: action.elementId,
                  selector: action.selector,
                  inputValue: action.inputValue,
                  url: action.url,
                },
              });
            }

            // Create NetworkExchanges
            for (const net of redactedNetwork) {
              await tx.networkExchange.create({
                data: {
                  browserSessionId: browserSession.id,
                  url: net.url,
                  method: net.method,
                  requestHeaders: net.requestHeaders,
                  requestBody: net.requestBody,
                  responseHeaders: net.responseHeaders,
                  responseBody: net.responseBody,
                  statusCode: net.statusCode,
                  latencyMs: net.latencyMs,
                },
              });
            }

            return createdTrace;
          });
        } catch (err: any) {
          if (err.code === 'P2002' || err.message?.includes('P2002') || err.message?.includes('Unique constraint')) {
            const existingTrace = await prisma.trace.findUnique({
              where: {
                projectId_externalTraceId: {
                  projectId: authContext.projectId,
                  externalTraceId: data.externalTraceId,
                },
              },
            });
            if (existingTrace) {
              if (existingTrace.payloadDigest !== payloadDigest) {
                return NextResponse.json(
                  { error: 'Idempotency conflict: A trace with this external ID already exists with a different payload' },
                  { status: 409 }
                );
              }
              return NextResponse.json({
                status: 'success',
                traceId: existingTrace.id,
                message: 'Trace already ingested (idempotent)',
              });
            }
          }
          throw err;
        }

        return NextResponse.json({
          status: 'success',
          traceId: trace.id,
        });
      }
    );
  } catch (err: any) {
    if (err.message?.includes('Unauthorized')) {
      return NextResponse.json(
        { error: err.message },
        { status: 401 }
      );
    }
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
