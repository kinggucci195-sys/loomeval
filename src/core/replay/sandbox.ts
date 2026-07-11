import { Page } from 'playwright';
import { prisma } from '../../lib/db';
import { EvaluationEngine } from '../evaluator/engine';
import { InvoiceAgent, AgentConfig } from '../agent/invoiceAgent';
import { DecisionProvider } from '../agent/decision';
import { validateSelector, validateUrl } from './vocabulary';
import { AppError } from '../errors/errors';

export interface ReplayCoverageReport {
  totalRecordedRequests: number;
  matchedRequests: number;
  unmatchedRequests: number;
  coveragePercentage: number;
}

export interface SandboxReplayReport {
  replayMode: 'FORENSIC' | 'PROTOCOL' | 'LIVE';
  success: boolean;
  mismatchDetail?: string;
  stepsReplayed: number;
  coverage?: ReplayCoverageReport;
  newTokenUsage?: number;
  newTraceId?: string;
}

export class ReplaySandbox {
  /**
   * Forensic Replay Mode:
   * Simply fetches and returns static recorded evidence (no execution).
   */
  static async runForensicInspection(traceId: string): Promise<SandboxReplayReport> {
    const trace = await prisma.trace.findUnique({
      where: { id: traceId },
      include: {
        browserSessions: {
          include: {
            actions: true,
            networkLogs: true,
          },
        },
      },
    });

    if (!trace || trace.browserSessions.length === 0) {
      throw new AppError({
        code: 'TRACE_NOT_FOUND',
        message: `Trace ${traceId} not found`,
        status: 404,
      });
    }

    const session = trace.browserSessions[0];
    const steps = session.actions.length;

    return {
      replayMode: 'FORENSIC',
      success: trace.status === 'SUCCESS',
      mismatchDetail: `Forensic inspection of trace ${traceId}: status is ${trace.status}`,
      stepsReplayed: steps,
    };
  }

  /**
   * Protocol Replay Mode:
   * Intercepts Playwright page network traffic and resolves requests using HAR logs.
   * Blocks unmapped requests and production domains by default.
   */
  static async runProtocolReplay(
    traceId: string,
    page: Page,
    allowListDomains: string[] = ['localhost', '127.0.0.1']
  ): Promise<SandboxReplayReport> {
    const trace = await prisma.trace.findUnique({
      where: { id: traceId },
      include: {
        browserSessions: {
          include: {
            actions: true,
            networkLogs: true,
          },
        },
      },
    });

    if (!trace || trace.browserSessions.length === 0) {
      throw new AppError({
        code: 'TRACE_NOT_FOUND',
        message: `Trace ${traceId} not found`,
        status: 404,
      });
    }

    const session = trace.browserSessions[0];
    const actions = session.actions;
    const networkLogs = [...session.networkLogs]; // Mutable copy for sequential matching

    let matchedRequests = 0;
    let unmatchedRequests = 0;
    const recordedMatches: string[] = [];
    const recordedUnmatches: string[] = [];

    // Enforce network safety and matching rules
    await page.route('**/*', async (route) => {
      const req = route.request();
      const url = req.url();
      const method = req.method();
      const postData = req.postData() || '';
      const resourceType = req.resourceType();

      // 1. Identify unsupported WebSockets and service workers
      if (
        resourceType === 'websocket' ||
        resourceType === 'eventsource' ||
        url.startsWith('ws://') ||
        url.startsWith('wss://') ||
        req.headers()['service-worker'] === 'script'
      ) {
        unmatchedRequests++;
        recordedUnmatches.push(`[UNSUPPORTED_PROTOCOL] ${method} ${url}`);
        await route.abort('blockedbyclient');
        return;
      }

      // 2. Reject non-allowlisted / production domains
      let urlObj: URL;
      try {
        urlObj = new URL(url);
      } catch {
        unmatchedRequests++;
        recordedUnmatches.push(`[INVALID_URL] ${method} ${url}`);
        await route.abort('blockedbyclient');
        return;
      }

      const isAllowedHost =
        allowListDomains.some((domain) => urlObj.hostname === domain) ||
        url.startsWith('file:///');

      if (!isAllowedHost) {
        unmatchedRequests++;
        recordedUnmatches.push(`[PRODUCTION_DOMAIN_BLOCKED] ${method} ${url}`);
        await route.abort('blockedbyclient');
        return;
      }

      // 3. Match Method, Canonical URL, Query parameters, and Request Body in order
      const matchIndex = networkLogs.findIndex((log) => {
        const logUrlObj = new URL(log.url);
        // Canonical URL match (protocol, hostname, pathname)
        const isCanonicalMatch =
          logUrlObj.protocol === urlObj.protocol &&
          logUrlObj.hostname === urlObj.hostname &&
          logUrlObj.pathname === urlObj.pathname;

        const isMethodMatch = log.method === method;

        // Query parameter match (exact keys and values)
        const isQueryMatch = logUrlObj.search === urlObj.search;

        // Request Body exact match for POST/PUT methods
        const isBodyMatch =
          method === 'POST' || method === 'PUT'
            ? (log.requestBody || '') === postData
            : true;

        return isCanonicalMatch && isMethodMatch && isQueryMatch && isBodyMatch;
      });

      if (matchIndex !== -1) {
        // Retrieve matched log and remove it from array to support repeated requests in order
        const matchedLog = networkLogs.splice(matchIndex, 1)[0];
        matchedRequests++;
        recordedMatches.push(`${method} ${url}`);
        await route.fulfill({
          status: matchedLog.statusCode,
          headers: JSON.parse(matchedLog.responseHeaders),
          body: matchedLog.responseBody || '',
        });
      } else {
        // 4. Block unmatched requests by default (No live fallback)
        unmatchedRequests++;
        recordedUnmatches.push(`[UNMATCHED] ${method} ${url}`);
        await route.abort('failed');
      }
    });

    let stepsReplayed = 0;
    try {
      for (const action of actions) {
        if (action.actionType === 'NAVIGATE' && action.url) {
          validateUrl(action.url);
          await page.goto(action.url);
        } else if (action.actionType === 'CLICK' && action.selector) {
          validateSelector(action.selector);
          await page.click(action.selector);
        } else if (action.actionType === 'FILL' && action.selector && action.inputValue) {
          validateSelector(action.selector);
          await page.fill(action.selector, action.inputValue);
        } else if (action.actionType === 'SUBMIT') {
          validateSelector('#submit-button');
          await page.click('#submit-button');
        }
        stepsReplayed++;
      }
    } catch (err: any) {
      return {
        replayMode: 'PROTOCOL',
        success: false,
        mismatchDetail: `Protocol execution mismatch at action ${stepsReplayed + 1}: ${err.message}`,
        stepsReplayed,
        coverage: {
          totalRecordedRequests: session.networkLogs.length,
          matchedRequests,
          unmatchedRequests,
          coveragePercentage:
            session.networkLogs.length > 0
              ? (matchedRequests / session.networkLogs.length) * 100
              : 100,
        },
      };
    }

    return {
      replayMode: 'PROTOCOL',
      success: true,
      stepsReplayed,
      coverage: {
        totalRecordedRequests: session.networkLogs.length,
        matchedRequests,
        unmatchedRequests,
        coveragePercentage:
          session.networkLogs.length > 0
            ? (matchedRequests / session.networkLogs.length) * 100
            : 100,
      },
    };
  }

  /**
   * Live Local Replay Mode:
   * Resets local state, runs the agent again, generates a new trace,
   * links and compares them. Ensures zero contact with production domains.
   */
  static async runLiveLocalReplay(
    sourceTraceId: string,
    agentConfig: AgentConfig,
    decisionProvider: DecisionProvider,
    targetUrl: string,
    vendorName: string,
    amount: number,
    resetStateUrl: string = 'http://localhost:3000/api/demo/invoices'
  ): Promise<SandboxReplayReport> {
    // Safety check: targetUrl must not contact production domains
    const targetUrlObj = new URL(targetUrl);
    const isLocal =
      targetUrlObj.protocol === 'file:' ||
      targetUrlObj.hostname === 'localhost' ||
      targetUrlObj.hostname === '127.0.0.1';

    if (!isLocal) {
      throw new AppError({
        code: 'REPLAY_SECURITY_VIOLATION',
        message: `Security Violation: Replay is forbidden to contact production domain: ${targetUrlObj.hostname}`,
        status: 400,
      });
    }

    // 1. Reset local state
    try {
      await fetch(resetStateUrl, { method: 'DELETE' });
    } catch (e) {
      // safe fallback if server endpoint is not active
    }

    // 2. Instantiate and execute actual agent run (generates a new trace)
    const agent = new InvoiceAgent(agentConfig, decisionProvider);
    const newSessionId = `replay_live_${Date.now()}`;
    const newExternalTraceId = `le_ext_${Date.now()}`;

    const newTraceId = await agent.runInvoiceEntry(
      targetUrl,
      vendorName,
      amount,
      newExternalTraceId,
      newSessionId
    );

    // 3. Fetch both traces for comparison
    const sourceTrace = await prisma.trace.findUnique({
      where: { id: sourceTraceId },
      include: { browserSessions: { include: { actions: true } } },
    });

    const newTrace = await prisma.trace.findUnique({
      where: { id: newTraceId },
      include: { browserSessions: { include: { actions: true } } },
    });

    if (!sourceTrace || !newTrace) {
      throw new Error('Trace comparison failed: trace logs not found');
    }

    // Link new trace to original trace record
    await prisma.trace.update({
      where: { id: newTraceId },
      data: {
        incidentId: sourceTrace.incidentId, // link incidents
      },
    });

    // 4. Compare action timelines and statuses
    const sourceActions = sourceTrace.browserSessions[0].actions;
    const newActions = newTrace.browserSessions[0].actions;

    let mismatchDetail: string | undefined = undefined;
    if (sourceActions.length !== newActions.length) {
      mismatchDetail = `Step count mismatch: source trace took ${sourceActions.length} actions, replay took ${newActions.length} actions.`;
    } else {
      for (let i = 0; i < sourceActions.length; i++) {
        if (sourceActions[i].actionType !== newActions[i].actionType) {
          mismatchDetail = `Action mismatch at step ${i + 1}: expected ${sourceActions[i].actionType}, got ${newActions[i].actionType}`;
          break;
        }
      }
    }

    // 5. Evaluate outcomes using rules
    const evalReport = await EvaluationEngine.evaluateInvoicePolicy(newTraceId);

    const replayJob = await prisma.replayJob.create({
      data: {
        replayMode: 'LIVE',
        status: evalReport.passed && !mismatchDetail ? 'COMPLETED' : 'FAILED',
      },
    });

    await prisma.replayResult.create({
      data: {
        replayJobId: replayJob.id,
        traceId: sourceTraceId,
        status: evalReport.passed && !mismatchDetail ? 'COMPLETED' : 'FAILED',
        mismatchDetail: mismatchDetail || 'Traces matched perfectly.',
      },
    });

    return {
      replayMode: 'LIVE',
      success: evalReport.passed && !mismatchDetail,
      mismatchDetail,
      stepsReplayed: newActions.length,
      newTraceId,
    };
  }
}
