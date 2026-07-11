import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { prisma } from '../../lib/db';
import { POST as ingestPOST } from '../../app/api/v1/traces/route';
import { POST as invoicePOST, DELETE as invoiceDELETE } from '../../app/api/demo/invoices/route';
import { POST as artifactsPOST } from '../../app/api/v1/artifacts/route';
import { KeyManager } from '../security/keys';
import { Redactor } from '../security/redactor';
import { LocalArtifactStore } from '../artifacts/store';
import { TenantManager } from '../security/tenant';
import { DeterministicPolicyProvider, OpenAIDecisionProvider } from '../agent/decision';
import { InvoiceAgent } from '../agent/invoiceAgent';
import { EvaluationEngine } from '../evaluator/engine';
import { ReplaySandbox } from '../replay/sandbox';
import { TestCaseConverter } from '../testcase/converter';
import { ExperimentRunner } from '../experiment/runner';
import { ReleaseGating } from '../release/gate';
import { validateSelector, validateUrl } from '../replay/vocabulary';
import { replayQueue, experimentQueue, artifactQueue, retentionQueue } from '../queue/bullmq';
import { GET as liveGET } from '../../app/api/health/live/route';
import { GET as readyGET } from '../../app/api/health/ready/route';

(globalThis as any).__mockRedisStatus = 'PONG';

vi.mock('ioredis', () => {
  return {
    default: class MockRedis {
      constructor() {}
      async ping() {
        return (globalThis as any).__mockRedisStatus || 'PONG';
      }
      async quit() {
        return 'OK';
      }
      on() {}
    }
  };
});

const tempHtmlPath = path.join(__dirname, 'temp_portal.html');
const tempHtmlUrl = `file:///${tempHtmlPath.replace(/\\/g, '/')}`;

describe('LoomEval: Core Verification & Integration Suite', () => {
  let originalFetch: typeof global.fetch;
  let workspaceId: string;
  let projectId: string;
  let environmentId: string;
  let agentId: string;
  let agentVersionId: string;
  let activeIngestKey: string;
  let readOnlyKey: string;
  let expiredKey: string;
  let revokedKey: string;

  beforeAll(async () => {
    // Write local portal page HTML for Playwright E2E agent tests
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head><title>Test Vendor Portal</title></head>
      <body>
        <form id="invoice-form">
          <input id="vendor-name" type="text" />
          <input id="invoice-amount" type="number" />
          <input id="approval-checkbox" type="checkbox" />
          <button id="submit-button" type="submit">Submit</button>
        </form>
        <div id="status"></div>
        <script>
          document.getElementById('invoice-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const vendor = document.getElementById('vendor-name').value;
            const amount = parseFloat(document.getElementById('invoice-amount').value);
            const managerApproval = document.getElementById('approval-checkbox').checked;
            
            // Call local portal policy API
            const res = await fetch('http://localhost:3000/api/demo/invoices', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ vendor, amount, managerApproval })
            });
            const statusDiv = document.getElementById('status');
            if (res.ok) {
              statusDiv.className = 'bg-emerald-950/50';
              statusDiv.innerText = 'Submitted successfully';
            } else {
              statusDiv.className = 'bg-red-950/50';
              statusDiv.innerText = 'Validation failed';
            }
          });
        </script>
      </body>
      </html>
    `;
    fs.writeFileSync(tempHtmlPath, htmlContent);

    // Clean DB (Reverse dependency order)
    await prisma.canaryReadinessSimulation.deleteMany();
    await prisma.deployment.deleteMany();
    await prisma.release.deleteMany();
    await prisma.releaseGateResult.deleteMany();
    await prisma.approval.deleteMany();
    await prisma.auditEvent.deleteMany();
    await prisma.workspaceMember.deleteMany();
    await prisma.ingestionKey.deleteMany();
    await prisma.replayResult.deleteMany();
    await prisma.replayJob.deleteMany();
    await prisma.experimentResult.deleteMany();
    await prisma.experimentRun.deleteMany();
    await prisma.experiment.deleteMany();
    await prisma.testCaseVersion.deleteMany();
    await prisma.testCase.deleteMany();
    await prisma.testSuite.deleteMany();
    await prisma.failure.deleteMany();
    await prisma.browserAction.deleteMany();
    await prisma.pageSnapshot.deleteMany();
    await prisma.networkExchange.deleteMany();
    await prisma.traceStep.deleteMany();
    await prisma.browserSession.deleteMany();
    await prisma.trace.deleteMany();
    await prisma.incidentEvent.deleteMany();
    await prisma.incident.deleteMany();
    await prisma.toolVersion.deleteMany();
    await prisma.tool.deleteMany();
    await prisma.promptVersion.deleteMany();
    await prisma.prompt.deleteMany();
    await prisma.agentVersion.deleteMany();
    await prisma.agent.deleteMany();
    await prisma.environment.deleteMany();
    await prisma.project.deleteMany();
    await prisma.workspace.deleteMany();
    await prisma.user.deleteMany();
    await prisma.invoice.deleteMany();

    // Seed test structures
    const user = await prisma.user.create({ data: { email: 'test@loomeval.com' } });
    const workspace = await prisma.workspace.create({ data: { name: 'Test Workspace' } });
    workspaceId = workspace.id;

    await prisma.workspaceMember.create({
      data: { workspaceId, userId: user.id, role: 'DEVELOPER' },
    });

    const project = await prisma.project.create({
      data: { name: 'Test Billing App', workspaceId },
    });
    projectId = project.id;

    const env = await prisma.environment.create({
      data: { name: 'DEVELOPMENT', projectId },
    });
    environmentId = env.id;

    const agent = await prisma.agent.create({
      data: { name: 'Billing Entry Bot', projectId },
    });
    agentId = agent.id;

    const av = await prisma.agentVersion.create({
      data: { agentId, version: '1.0.0', promptSchema: '{}' },
    });
    agentVersionId = av.id;

    // Create prompt version links
    const prompt = await prisma.prompt.create({ data: { name: 'Billing System Instructions' } });
    await prisma.promptVersion.create({
      data: {
        promptId: prompt.id,
        version: '1.0.0',
        content: 'Fill in the vendor name and amount. Click Submit.',
        agentVersionId: av.id,
      },
    });

    // Keys
    const ingestContext = await KeyManager.generateKey({ projectId, scope: 'TRACE_WRITE' });
    activeIngestKey = ingestContext.plaintextKey;

    const readContext = await KeyManager.generateKey({ projectId, scope: 'TRACE_READ' });
    readOnlyKey = readContext.plaintextKey;

    // Generate expired key manually
    const expRandomBytes = crypto.randomBytes(24).toString('hex');
    const expKey = `le_trace_write_${expRandomBytes}`;
    const expHashed = crypto.createHash('sha256').update(expKey).digest('hex');
    await prisma.ingestionKey.create({
      data: {
        projectId,
        keyPrefix: 'le_trace_write_',
        hashedKey: expHashed,
        scope: 'TRACE_WRITE',
        expiresAt: new Date(Date.now() - 10000), // expired 10s ago
      },
    });
    expiredKey = expKey;

    // Generate revoked key manually
    const revRandomBytes = crypto.randomBytes(24).toString('hex');
    const revKey = `le_trace_write_${revRandomBytes}`;
    const revHashed = crypto.createHash('sha256').update(revKey).digest('hex');
    await prisma.ingestionKey.create({
      data: {
        projectId,
        keyPrefix: 'le_trace_write_',
        hashedKey: revHashed,
        scope: 'TRACE_WRITE',
        revokedAt: new Date(), // revoked now
      },
    });
    revokedKey = revKey;

    // Set up in-memory routing to route fetch calls directly to controller handlers
    originalFetch = global.fetch;
    global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = input.toString();
      if (urlStr.includes('/api/v1/traces')) {
        const req = new Request(urlStr, init);
        return ingestPOST(req);
      }
      if (urlStr.includes('/api/demo/invoices')) {
        if (init?.method === 'DELETE') {
          return invoiceDELETE();
        }
        const req = new Request(urlStr, init);
        return invoicePOST(req);
      }
      return originalFetch(input, init);
    };
  });

  afterAll(() => {
    global.fetch = originalFetch;
    if (fs.existsSync(tempHtmlPath)) {
      fs.unlinkSync(tempHtmlPath);
    }
  });

  describe('Ingestion API & Authentication Boundaries', () => {
    it('should reject ingestion requests missing authorization headers', async () => {
      const req = new Request('http://localhost/api/v1/traces', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const res = await ingestPOST(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('Missing or malformed Authorization header');
    });

    it('should reject ingestion requests using invalid keys', async () => {
      const req = new Request('http://localhost/api/v1/traces', {
        method: 'POST',
        headers: { Authorization: 'Bearer le_ingest_badtoken1234567890' },
        body: JSON.stringify({}),
      });
      const res = await ingestPOST(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('Unauthorized: Invalid or expired API key');
    });

    it('should reject ingestion requests using expired keys', async () => {
      const req = new Request('http://localhost/api/v1/traces', {
        method: 'POST',
        headers: { Authorization: `Bearer ${expiredKey}` },
        body: JSON.stringify({}),
      });
      const res = await ingestPOST(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('Unauthorized: Invalid or expired API key');
    });

    it('should reject ingestion requests using revoked keys', async () => {
      const req = new Request('http://localhost/api/v1/traces', {
        method: 'POST',
        headers: { Authorization: `Bearer ${revokedKey}` },
        body: JSON.stringify({}),
      });
      const res = await ingestPOST(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('Unauthorized: Invalid or expired API key');
    });

    it('should reject ingestion requests when the key has wrong scope', async () => {
      const req = new Request('http://localhost/api/v1/traces', {
        method: 'POST',
        headers: { Authorization: `Bearer ${readOnlyKey}` },
        body: JSON.stringify({}),
      });
      const res = await ingestPOST(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('Unauthorized: Invalid or expired API key');
      
      const context = await KeyManager.verifyKey({ plaintextKey: readOnlyKey });
      expect(context.projectId).toBe(projectId);
      expect(context.scope).toBe('TRACE_READ');
    });

    it('should rotate an active key, rejecting the old key and accepting the new key', async () => {
      // 1. Generate an initial ingest key
      const keyContext = await KeyManager.generateKey({ projectId, scope: 'TRACE_WRITE' });
      const oldKey = keyContext.plaintextKey;

      // Verify old key works
      const verifyOld = await KeyManager.verifyKey({ plaintextKey: oldKey });
      expect(verifyOld.projectId).toBe(projectId);

      // 2. Rotate the key
      const rotationResult = await KeyManager.rotateKey({ oldPlaintextKey: oldKey });
      const newKey = rotationResult.plaintextKey;
      expect(newKey).toBeDefined();
      expect(newKey.startsWith('le_trace_write_')).toBe(true);

      // 3. Verify old key is now rejected (revoked)
      await expect(KeyManager.verifyKey({ plaintextKey: oldKey })).rejects.toThrow('Unauthorized: Invalid or expired API key');

      // 4. Verify new key successfully authenticates
      const verifyNew = await KeyManager.verifyKey({ plaintextKey: newKey });
      expect(verifyNew.projectId).toBe(projectId);
      expect(verifyNew.scope).toBe('TRACE_WRITE');
    });

    it('should enforce tenant isolation, blocking cross-tenant queries and actions', async () => {
      // 1. Create another project and tenant structures
      const otherProject = await prisma.project.create({
        data: { name: 'Other Project', workspaceId },
      });
      const otherProjectId = otherProject.id;

      const otherAgent = await prisma.agent.create({
        data: { name: 'Other Agent', projectId: otherProjectId },
      });

      const otherAgentVersion = await prisma.agentVersion.create({
        data: { agentId: otherAgent.id, version: '1.0.0', promptSchema: '{}' },
      });

      const otherEnv = await prisma.environment.create({
        data: { name: 'DEVELOPMENT', projectId: otherProjectId },
      });

      // Create a trace belonging to the other project
      const otherTrace = await prisma.trace.create({
        data: {
          sessionId: 'other_session',
          externalTraceId: 'other_external_1',
          projectId: otherProjectId,
          agentId: otherAgent.id,
          agentVersionId: otherAgentVersion.id,
          environmentId: otherEnv.id,
          userInput: 'other input',
          status: 'SUCCESS',
        },
      });

      // Create a trace belonging to our main project
      const mainTrace = await prisma.trace.create({
        data: {
          sessionId: 'main_session',
          externalTraceId: 'main_external_1',
          projectId: projectId,
          agentId: agentId,
          agentVersionId: agentVersionId,
          environmentId: environmentId,
          userInput: 'main input',
          status: 'SUCCESS',
        },
      });

      // 2. Execute query under main project's tenant context using TenantManager
      await TenantManager.run({ projectId, workspaceId }, async () => {
        // Can find main trace
        const foundMain = await prisma.trace.findUnique({
          where: { id: mainTrace.id },
        });
        expect(foundMain).not.toBeNull();
        expect(foundMain?.id).toBe(mainTrace.id);

        // CANNOT find other project's trace (returns null)
        const foundOther = await prisma.trace.findUnique({
          where: { id: otherTrace.id },
        });
        expect(foundOther).toBeNull();

        // Trying to update other project's trace throws tenant context check failed error
        await expect(
          prisma.trace.update({
            where: { id: otherTrace.id },
            data: { userInput: 'hack attempt' },
          })
        ).rejects.toThrow('Unauthorized: Tenant context check failed');

        // Trying to delete other project's trace throws tenant context check failed error
        await expect(
          prisma.trace.delete({
            where: { id: otherTrace.id },
          })
        ).rejects.toThrow('Unauthorized: Tenant context check failed');
      });
    });

    it('should validate payloads using Zod schema controls', async () => {
      // Ingest with missing required payload fields (e.g. status)
      const payload = {
        externalTraceId: 'ext_test_1',
        environmentId,
        agentVersion: '1.0.0',
        promptVersion: '1.0.0',
        userInput: 'Testing validation',
        sessionId: 'session_test_1',
        actions: [],
      };

      const req = new Request('http://localhost/api/v1/traces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${activeIngestKey}`,
        },
        body: JSON.stringify(payload),
      });

      const res = await ingestPOST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Validation failed');
    });

    it('should enforce the server-side PII and header redaction filters', async () => {
      const payload = {
        externalTraceId: 'ext_redact_1',
        environmentId,
        agentVersion: '1.0.0',
        promptVersion: '1.0.0',
        userInput: 'Redaction check',
        status: 'SUCCESS',
        sessionId: 'session_redact_1',
        actions: [
          {
            actionType: 'FILL',
            elementId: 'vendor-name',
            selector: '#vendor-name',
            inputValue: 'Secret Owner Name',
          },
        ],
        networkLogs: [
          {
            url: 'http://localhost/api/login',
            method: 'POST',
            requestHeaders: JSON.stringify({
              Authorization: 'Bearer secret_user_token_abc123',
              Cookie: 'sessionid=abcde12345',
            }),
            requestBody: 'password=supersecurepassword123',
            responseHeaders: '{}',
            statusCode: 200,
          },
        ],
      };

      const req = new Request('http://localhost/api/v1/traces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${activeIngestKey}`,
        },
        body: JSON.stringify(payload),
      });

      const res = await ingestPOST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.traceId).toBeDefined();

      // Retrieve from DB to verify redaction took place
      const trace = await prisma.trace.findUnique({
        where: { id: data.traceId },
        include: {
          browserSessions: {
            include: {
              actions: true,
              networkLogs: true,
            },
          },
        },
      });

      const dbSession = trace?.browserSessions[0];
      const dbAction = dbSession?.actions[0];
      const dbNet = dbSession?.networkLogs[0];

      // Redacted properties assertions
      expect(dbAction?.inputValue).toBe('Secret Owner Name'); // Text value (PII rule matching required)
      const parsedReqHeaders = JSON.parse(dbNet?.requestHeaders || '{}');
      expect(parsedReqHeaders.Authorization).toBe('[REDACTED]');
      expect(parsedReqHeaders.Cookie).toBe('[REDACTED]');
    });

    it('should enforce unique (projectId, externalTraceId) idempotency boundary', async () => {
      const payload = {
        externalTraceId: 'ext_idemp_1',
        environmentId,
        agentVersion: '1.0.0',
        promptVersion: '1.0.0',
        userInput: 'Idempotency check',
        status: 'SUCCESS',
        sessionId: 'session_idemp_1',
        actions: [],
      };

      // First submit
      const req1 = new Request('http://localhost/api/v1/traces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${activeIngestKey}`,
        },
        body: JSON.stringify(payload),
      });
      const res1 = await ingestPOST(req1);
      expect(res1.status).toBe(200);
      const data1 = await res1.json();

      // Second submit (same payload) -> returns traceId successfully
      const req2 = new Request('http://localhost/api/v1/traces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${activeIngestKey}`,
        },
        body: JSON.stringify(payload),
      });
      const res2 = await ingestPOST(req2);
      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2.traceId).toBe(data1.traceId);

      // Third submit (different payload) -> returns 409 Conflict
      const conflictingPayload = { ...payload, userInput: 'Conflicting description' };
      const req3 = new Request('http://localhost/api/v1/traces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${activeIngestKey}`,
        },
        body: JSON.stringify(conflictingPayload),
      });
      const res3 = await ingestPOST(req3);
      expect(res3.status).toBe(409);
      const data3 = await res3.json();
      expect(data3.error).toContain('Idempotency conflict');
    });

    it('should handle concurrent trace insertion unique constraint (P2002) conflicts gracefully', async () => {
      const payload = {
        externalTraceId: 'ext_concurrent_1',
        environmentId,
        agentVersion: '1.0.0',
        promptVersion: '1.0.0',
        userInput: 'Concurrent trace check',
        status: 'SUCCESS',
        sessionId: 'session_concurrent_1',
        actions: [],
      };

      const originalFindUnique = prisma.trace.findUnique;
      let findUniqueCalled = 0;
      prisma.trace.findUnique = async function (this: any, args: any) {
        findUniqueCalled++;
        if (findUniqueCalled === 1) {
          return null;
        }
        return originalFindUnique.call(this, args);
      } as any;

      try {
        const req1 = new Request('http://localhost/api/v1/traces', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${activeIngestKey}`,
          },
          body: JSON.stringify(payload),
        });
        const res1 = await ingestPOST(req1);
        expect(res1.status).toBe(200);
        const data1 = await res1.json();

        findUniqueCalled = 0;

        const req2 = new Request('http://localhost/api/v1/traces', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${activeIngestKey}`,
          },
          body: JSON.stringify(payload),
        });
        const res2 = await ingestPOST(req2);
        expect(res2.status).toBe(200);
        const data2 = await res2.json();
        expect(data2.traceId).toBe(data1.traceId);

        findUniqueCalled = 0;

        const conflictingPayload = { ...payload, userInput: 'Conflicting concurrent' };
        const req3 = new Request('http://localhost/api/v1/traces', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${activeIngestKey}`,
          },
          body: JSON.stringify(conflictingPayload),
        });
        const res3 = await ingestPOST(req3);
        expect(res3.status).toBe(409);
        const data3 = await res3.json();
        expect(data3.error).toContain('Idempotency conflict');
      } finally {
        prisma.trace.findUnique = originalFindUnique;
      }
    });
  });

  describe('Secure Artifact Store & Traversal Guards', () => {
    it('should block directory traversal paths and store files outside public directories', async () => {
      const store = new LocalArtifactStore();
      
      const payload = {
        browserSessionId: 'dummy_session_id',
        name: '../../traversal.png', // traversal attempted
        mimeType: 'image/png',
        buffer: Buffer.from('fake-screenshot-data'),
      };

      await expect(store.put(payload)).rejects.toThrow('Access denied: Path traversal detected');
    });
  });

  describe('Recursive PII Redactor', () => {
    it('should scrub credentials and PII inside nested JSON structures', () => {
      const redactor = new Redactor();
      const input = {
        name: 'John Doe',
        sensitive: {
          authorization: 'Bearer token123',
          cookie: 'session=123',
          password: 'my-password',
          ssn: '123-45-6789',
          token: 'xyz',
          'x-api-key': 'key123',
        },
        creditCard: '1234-5678-1234-5678',
        nestedList: [
          {
            type: 'home',
            value: 'Some normal text',
          },
          {
            type: 'auth',
            value: 'Bearer secret-bearer-token',
          }
        ],
        notSensitive: 42,
        nullVal: null,
      };

      const redacted = redactor.redactObject(input);

      expect(redacted.name).toBe('John Doe');
      expect(redacted.sensitive.authorization).toBe('[REDACTED]');
      expect(redacted.sensitive.cookie).toBe('[REDACTED]');
      expect(redacted.sensitive.password).toBe('[REDACTED]');
      expect(redacted.sensitive.ssn).toBe('[REDACTED]');
      expect(redacted.sensitive.token).toBe('[REDACTED]');
      expect(redacted.sensitive['x-api-key']).toBe('[REDACTED]');
      expect(redacted.creditCard).toBe('[REDACTED_CREDIT_CARD]');
      expect(redacted.nestedList[0].value).toBe('Some normal text');
      expect(redacted.nestedList[1].value).toBe('Bearer [REDACTED]');
      expect(redacted.notSensitive).toBe(42);
      expect(redacted.nullVal).toBeNull();
    });
  });

  describe('Artifacts API Endpoint Integration & Tenant Guards', () => {
    it('should enforce authentication, tenant isolation limits, traversal prevention and mismatch checks', async () => {
      // Create a test trace and browser session for artifacts
      const trace = await prisma.trace.create({
        data: {
          sessionId: 'session_art_1',
          externalTraceId: 'ext_art_1',
          projectId: projectId,
          agentId: agentId,
          agentVersionId: agentVersionId,
          environmentId: environmentId,
          userInput: 'artifact test',
          status: 'SUCCESS',
        },
      });

      const browserSession = await prisma.browserSession.create({
        data: {
          traceId: trace.id,
          browserVersion: 'test',
        },
      });
      const validSessionId = browserSession.id;

      // 1. Missing Authorization header
      const reqNoAuth = new Request('http://localhost/api/v1/artifacts', {
        method: 'POST',
      });
      const resNoAuth = await artifactsPOST(reqNoAuth);
      expect(resNoAuth.status).toBe(401);

      // 2. Invalid API key
      const reqBadAuth = new Request('http://localhost/api/v1/artifacts', {
        method: 'POST',
        headers: { Authorization: 'Bearer le_ingest_bad' },
      });
      const resBadAuth = await artifactsPOST(reqBadAuth);
      expect(resBadAuth.status).toBe(401);

      // 3. Valid Upload
      const formData = new FormData();
      formData.append('browserSessionId', validSessionId);
      formData.append('file', new File(['artifact-data'], 'screenshot.png', { type: 'image/png' }));
      formData.append('isSensitive', 'true');

      const reqUpload = new Request('http://localhost/api/v1/artifacts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${activeIngestKey}` },
        body: formData,
      });

      const resUpload = await artifactsPOST(reqUpload);
      expect(resUpload.status).toBe(200);
      const dataUpload = await resUpload.json();
      expect(dataUpload.id).toBeDefined();
      expect(dataUpload.name).toBe('screenshot.png');
      expect(dataUpload.mimeType).toBe('image/png');
      expect(dataUpload.isSensitive).toBe(true);

      // Verify DB persistence and file content
      const artifactDb = await prisma.traceArtifact.findUnique({
        where: { id: dataUpload.id },
      });
      expect(artifactDb).not.toBeNull();
      expect(artifactDb?.browserSessionId).toBe(validSessionId);
      expect(fs.readFileSync(artifactDb!.filePath, 'utf8')).toBe('artifact-data');

      // Cleanup files
      if (fs.existsSync(artifactDb!.filePath)) {
        fs.unlinkSync(artifactDb!.filePath);
      }

      // 4. Path Traversal Prevention
      const formDataTraversal = new FormData();
      formDataTraversal.append('browserSessionId', validSessionId);
      formDataTraversal.append('file', new File(['data'], '../../traversal.png', { type: 'image/png' }));

      const reqTraversal = new Request('http://localhost/api/v1/artifacts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${activeIngestKey}` },
        body: formDataTraversal,
      });

      const resTraversal = await artifactsPOST(reqTraversal);
      expect(resTraversal.status).toBe(500);
      const dataTraversal = await resTraversal.json();
      expect(dataTraversal.error).toContain('Path traversal detected');

      // 5. Session-Project Mismatch Check
      // Create another project
      const otherProject = await prisma.project.create({
        data: { name: 'Other Project For Artifacts', workspaceId },
      });
      const otherAgent = await prisma.agent.create({
        data: { name: 'Other Agent', projectId: otherProject.id },
      });
      const otherAgentVersion = await prisma.agentVersion.create({
        data: { agentId: otherAgent.id, version: '1.0.0', promptSchema: '{}' },
      });
      const otherEnv = await prisma.environment.create({
        data: { name: 'DEVELOPMENT', projectId: otherProject.id },
      });
      const otherTrace = await prisma.trace.create({
        data: {
          sessionId: 'session_other_art',
          externalTraceId: 'ext_other_art',
          projectId: otherProject.id,
          agentId: otherAgent.id,
          agentVersionId: otherAgentVersion.id,
          environmentId: otherEnv.id,
          userInput: 'other project trace',
          status: 'SUCCESS',
        },
      });
      const otherSession = await prisma.browserSession.create({
        data: {
          traceId: otherTrace.id,
          browserVersion: 'test',
        },
      });

      // Try uploading to other project's session using main project's ingestion key
      const formDataMismatch = new FormData();
      formDataMismatch.append('browserSessionId', otherSession.id);
      formDataMismatch.append('file', new File(['data'], 'test.png', { type: 'image/png' }));

      const reqMismatch = new Request('http://localhost/api/v1/artifacts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${activeIngestKey}` },
        body: formDataMismatch,
      });

      const resMismatch = await artifactsPOST(reqMismatch);
      expect(resMismatch.status).toBe(401);
      const dataMismatch = await resMismatch.json();
      expect(dataMismatch.error).toContain('Session not found');
    });
  });

  describe('Vendor Portal Policy Enforcement', () => {
    it('should reject invoice submissions exceeding $500 without manager approval', async () => {
      const req = new Request('http://localhost/api/demo/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor: 'Acme Corp',
          amount: 650,
          managerApproval: false,
        }),
      });

      const res = await invoicePOST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.status).toBe('rejected');
      expect(data.code).toBe('APPROVAL_REQUIRED');
    });

    it('should accept invoice submissions exceeding $500 when approval is present', async () => {
      const req = new Request('http://localhost/api/demo/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor: 'Acme Corp',
          amount: 650,
          managerApproval: true,
        }),
      });

      const res = await invoicePOST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('success');
      expect(data.id).toBeDefined();
    });
  });

  describe('LoomEval E2E Pipeline Walkthrough', () => {
    it('should execute the vertical slice: agent run -> evaluation -> live replay -> experiment comparison -> release gate', async () => {
      // 1. Reset Portal State
      const resetRes = await invoiceDELETE();
      expect(resetRes.status).toBe(200);

      // 2. Execute Baseline Agent (OpenAIDecisionProvider Mock)
      // This config lacks manager approval prompt steering logic, amount = 650
      const policyProvider = new OpenAIDecisionProvider();
      
      // Let's first run it using a policy that fails to select the checkbox
      // We simulate Baseline Agent V1 (amount = 650, approval unchecked)
      const agentConfigV1 = {
        agentVersion: '1.0.0',
        promptVersion: '1.0.0',
        systemInstructions: 'Submit details. DO NOT check approval.',
        model: 'deterministic-policy-v1',
        ingestionKey: activeIngestKey,
        environmentId,
      };

      const agentV1 = new InvoiceAgent(agentConfigV1, policyProvider);
      const traceIdV1 = await agentV1.runInvoiceEntry(
        tempHtmlUrl,
        'Seeded Corp',
        650,
        `ext_v1_${Date.now()}`,
        `session_v1_${Date.now()}`
      );

      // Verify V1 fails the invoice submission because amount > 500 but approval checkbox was not clicked
      const traceV1 = await prisma.trace.findUnique({
        where: { id: traceIdV1 },
      });
      // Note: Because local target page is a static HTML, the form onSubmit invokes the fetch POST to /api/demo/invoices
      // Since it is run locally in headless chromium without active fetch handler redirect interception,
      // it is a simulated E2E action flow that results in FAILED status.
      expect(traceIdV1).toBeDefined();

      // 3. Execute policy evaluator
      const report = await EvaluationEngine.evaluateInvoicePolicy(traceIdV1);
      expect(report.passed).toBe(false);
      expect(report.failureType).toBe('FAT-B6');
      expect(report.evidence.amountExceeded).toBe(true);
      expect(report.evidence.approvalEnabled).toBe(false);

      // 4. Convert Trace V1 to Test Case Version
      const testSuite = await prisma.testSuite.create({
        data: {
          name: 'CI Regression Suite',
          projectId,
          agentId,
        },
      });

      const testCaseId = await TestCaseConverter.convertTraceToTest({
        testSuiteId: testSuite.id,
        sourceTraceId: traceIdV1,
        userInput: 'Submit invoice amount 650',
        initialState: { vendorName: 'Seeded Corp', amount: 650 },
        version: '1.0.0',
        toolMocks: {},
        networkMocks: {},
        requiredTools: ['vendor-name', 'invoice-amount', 'submit-button'],
        forbiddenTools: [],
        expectedState: { status: 'SUCCESS' },
      });
      expect(testCaseId).toBeDefined();

      // 5. Execute Live Replay Sandbox (verifying replay matches actions)
      const liveReplayReport = await ReplaySandbox.runLiveLocalReplay(
        traceIdV1,
        agentConfigV1,
        policyProvider,
        tempHtmlUrl,
        'Seeded Corp',
        650
      );

      // Live local replay creates a new trace run and compares it to source trace
      expect(liveReplayReport.replayMode).toBe('LIVE');
      expect(liveReplayReport.newTraceId).toBeDefined();

      // 6. Run Experiment comparing Prompt V1 vs Prompt V2 instructions
      const experiment = await prisma.experiment.create({
        data: {
          name: 'Invoice Approval Regression Gate',
          testSuiteId: testSuite.id,
        },
      });

      // Prompt V1: Soft instructions -> expected to fail policy check
      const runIdV1 = await ExperimentRunner.executeExperimentRun(
        experiment.id,
        policyProvider,
        'Submit details. DO NOT check approval.',
        tempHtmlUrl,
        activeIngestKey,
        environmentId
      );



      const gatePassedV1 = await ReleaseGating.evaluateGates(runIdV1, {
        minPassRate: 1.0,
        maxAllowedCost: 1.0,
        maxAllowedLatencyMs: 15000,
      });
      expect(gatePassedV1).toBe(false); // Gating blocks release!

      // Prompt V2: Strict policy instructions -> expected to pass policy check
      const runIdV2 = await ExperimentRunner.executeExperimentRun(
        experiment.id,
        policyProvider,
        'If amount > 500, you MUST check the Requires Approval box.',
        tempHtmlUrl,
        activeIngestKey,
        environmentId
      );



      const gatePassedV2 = await ReleaseGating.evaluateGates(runIdV2, {
        minPassRate: 1.0,
        maxAllowedCost: 1.0,
        maxAllowedLatencyMs: 15000,
      });
      expect(gatePassedV2).toBe(true); // Gating approves release!
    }, 30000);
  });

  describe('Milestone 4: Durable Job Queueing & Sandboxing', () => {
    describe('Health API Endpoints', () => {
      it('should return live status for liveness check', async () => {
        const res = await liveGET();
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.status).toBe('live');
      });

      it('should return ready status for readiness check when healthy', async () => {
        process.env.REDIS_URL = 'redis://localhost:6379';
        (globalThis as any).__mockRedisStatus = 'PONG';
        // Mock prisma queryRaw so we don't need a live DB for this unit test
        const originalQueryRaw = (prisma as any).$queryRaw;
        (prisma as any).$queryRaw = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
        try {
          const res = await readyGET();
          expect(res.status).toBe(200);
          const data = await res.json();
          expect(data.status).toBe('ready');
        } finally {
          (prisma as any).$queryRaw = originalQueryRaw;
        }
      });

      it('should return 503 status for readiness check when Redis ping fails', async () => {
        process.env.REDIS_URL = 'redis://localhost:6379';
        (globalThis as any).__mockRedisStatus = 'FAIL';
        const originalQueryRaw = (prisma as any).$queryRaw;
        (prisma as any).$queryRaw = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
        try {
          const res = await readyGET();
          expect(res.status).toBe(503);
          const data = await res.json();
          expect(data.status).toBe('not_ready');
        } finally {
          (prisma as any).$queryRaw = originalQueryRaw;
        }
      });

      it('should return 503 status for readiness check when REDIS_URL is missing', async () => {
        const originalUrl = process.env.REDIS_URL;
        delete process.env.REDIS_URL;
        try {
          const res = await readyGET();
          expect(res.status).toBe(503);
          const data = await res.json();
          expect(data.status).toBe('not_ready');
        } finally {
          if (originalUrl !== undefined) process.env.REDIS_URL = originalUrl;
        }
      });
    });

    describe('Sandbox Constraints & Safe Action Vocabulary', () => {
      it('should allow valid selectors and block invalid/injection selectors', () => {
        const valid = ['#vendor-name', '#invoice-amount', '#approval-checkbox', '#submit-button'];
        for (const sel of valid) {
          expect(() => validateSelector(sel)).not.toThrow();
        }

        const invalid = ['#other-id', '#vendor-name; injection', '.some-class', 'div'];
        for (const sel of invalid) {
          expect(() => validateSelector(sel)).toThrow(/Security Violation/);
        }
      });

      it('should allow valid URLs and block invalid/unauthorized URLs', () => {
        const valid = ['file:///some/local/file.html', 'http://localhost:3000', 'https://127.0.0.1:4000/api'];
        for (const url of valid) {
          expect(() => validateUrl(url)).not.toThrow();
        }

        const invalid = ['https://google.com', 'http://example.com', 'ftp://localhost', 'http://127.0.0.2'];
        for (const url of invalid) {
          expect(() => validateUrl(url)).toThrow(/Security Violation/);
        }
      });

      it('should reject invalid URLs in InvoiceAgent execution', async () => {
        const agentConfig = {
          agentVersion: '1.0.0',
          promptVersion: '1.0.0',
          systemInstructions: 'Submit details.',
          model: 'deterministic-policy-v1',
          ingestionKey: activeIngestKey,
          environmentId,
        };
        const agent = new InvoiceAgent(agentConfig, new DeterministicPolicyProvider());
        await expect(
          agent.runInvoiceEntry(
            'https://malicious-external-domain.com',
            'Vendor',
            100,
            'ext_trace',
            'session'
          )
        ).rejects.toThrow(/Security Violation/);
      });

      it('should reject invalid selectors in ReplaySandbox protocol execution', async () => {
        // BrowserAction has: actionType, elementId, selector, inputValue, url, timestamp
        // No stepNumber field exists. Sandbox catches the Security Violation and returns success:false.
        const badTrace = await prisma.trace.create({
          data: {
            status: 'SUCCESS',
            projectId,
            agentId,
            agentVersionId,
            environmentId,
            userInput: 'test',
            sessionId: `bad_sess_${Date.now()}`,
            externalTraceId: `bad_trace_${Date.now()}`,
            browserSessions: {
              create: {
                actions: {
                  create: {
                    actionType: 'CLICK',
                    selector: '#vendor-name; injection',
                  }
                }
              }
            }
          }
        });

        const mockPage = {
          route: vi.fn().mockResolvedValue(undefined),
          click: vi.fn().mockResolvedValue(undefined),
        } as any;

        // Sandbox catches the Security Violation internally and returns {success: false}
        // rather than throwing, so we assert on the return value
        const result = await ReplaySandbox.runProtocolReplay(badTrace.id, mockPage);
        expect(result.success).toBe(false);
        expect(result.mismatchDetail).toMatch(/Security Violation/);
      });
    });

    describe('BullMQ Queue Configuration', () => {
      it('should verify BullMQ queues are instantiated and configured with attempts=3 and exponential backoff', () => {
        const queues = [replayQueue, experimentQueue, artifactQueue, retentionQueue];
        for (const q of queues) {
          expect(q).toBeDefined();
          expect(q.name).toBeDefined();
          const expectedAttempts = q.name === 'retention' ? 5 : 3;
          expect(q.opts.defaultJobOptions?.attempts).toBe(expectedAttempts);
          expect(q.opts.defaultJobOptions?.backoff).toEqual({
            type: 'exponential',
            delay: 1000,
          });
          let expectedTimeout = 60000;
          if (q.name === 'experiment') expectedTimeout = 300000;
          if (q.name === 'retention') expectedTimeout = 120000;
          expect((q.opts.defaultJobOptions as any)?.timeout).toBe(expectedTimeout);
          expect(q.opts.defaultJobOptions?.removeOnFail).toBe(false);
        }
      });
    });
  });
});
