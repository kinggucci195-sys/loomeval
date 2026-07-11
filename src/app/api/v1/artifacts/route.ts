import { NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { KeyManager } from '../../../../core/security/keys';
import { TenantManager } from '../../../../core/security/tenant';
import { LocalArtifactStore } from '../../../../core/artifacts/store';

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
      authContext = await KeyManager.verifyKey({
        plaintextKey: token,
      });
      if (authContext.scope !== 'ARTIFACT_WRITE' && authContext.scope !== 'TRACE_WRITE') {
        return NextResponse.json({ error: 'Unauthorized: Invalid scope for artifact upload' }, { status: 401 });
      }
    } catch (err: any) {
      return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
    }

    return await TenantManager.run(
      { projectId: authContext.projectId, workspaceId: authContext.workspaceId },
      async () => {
        // Parse request as multipart/form-data
        let formData;
        try {
          formData = await request.formData();
        } catch (e) {
          return NextResponse.json({ error: 'Invalid multipart/form-data' }, { status: 400 });
        }

        const browserSessionId = formData.get('browserSessionId');
        const file = formData.get('file');
        const stepId = formData.get('stepId');
        const isSensitiveStr = formData.get('isSensitive');

        if (!browserSessionId || typeof browserSessionId !== 'string') {
          return NextResponse.json({ error: 'browserSessionId is required' }, { status: 400 });
        }

        if (!file || !(file instanceof File)) {
          return NextResponse.json({ error: 'file is required' }, { status: 400 });
        }

        // Ensure the browserSessionId exists and belongs to the authenticated project
        const trace = await prisma.trace.findFirst({
          where: {
            browserSessions: {
              some: {
                id: browserSessionId
              }
            }
          }
        });

        if (!trace) {
          return NextResponse.json({ error: 'Unauthorized: Session not found' }, { status: 401 });
        }

        // Read other optional parameters
        const parsedStepId = typeof stepId === 'string' ? stepId : undefined;
        const isSensitive = isSensitiveStr === 'true';

        // Read file contents as buffer
        const buffer = Buffer.from(await file.arrayBuffer());

        // Call LocalArtifactStore to persist the file
        const store = new LocalArtifactStore();
        const storedArtifact = await store.put({
          browserSessionId,
          stepId: parsedStepId,
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          buffer,
          isSensitive
        });

        return NextResponse.json(storedArtifact);
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
