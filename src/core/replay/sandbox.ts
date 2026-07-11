import { Page } from 'playwright';
import { prisma } from '../../lib/db';
import { EvaluationEngine } from '../evaluator/engine';
import { InvoiceAgent, AgentConfig } from '../agent/invoiceAgent';
import { DecisionProvider } from '../agent/decision';
import { validateSelector, validateUrl } from './vocabulary';

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
      throw new Error('Trace not found.');
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
   * Blocks unmapped requests and production domains.
   */
  static async runProtocolReplay(
    traceId: string,
    page: Page,
    allowListDomains: string[] = ['localhost']
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
      throw new Error('Trace not found.');
    }

    const session = trace.browserSessions[0];
    const actions = session.actions;
    const networkLogs = session.networkLogs;

    let matchedRequests = 0;
    let unmatchedRequests = 0;

    // Enforce network safety and matching rules
    await page.route('**/*', async (route) => {
      const req = route.request();
      const url = req.url();
      const method = req.method();
      const postData = req.postData() || '';

      const urlObj = new URL(url);

      // Block production domains
      const isAllowedHost = allowListDomains.some(domain => urlObj.hostname === domain) || url.startsWith('file:///');
      if (!isAllowedHost) {
        unmatchedRequests++;
        await route.abort('blockedbyclient');
        return;
      }

      // Match against stored HAR logs
      const match = networkLogs.find((log) => {
        const isUrlMatch = log.url === url;
        const isMethodMatch = log.method === method;
        const isBodyMatch = method === 'POST' || method === 'PUT'
          ? (log.requestBody || '') === postData
          : true;
        return isUrlMatch && isMethodMatch && isBodyMatch;
      });

      if (match) {
        matchedRequests++;
        await route.fulfill({
          status: match.statusCode,
          headers: JSON.parse(match.responseHeaders),
          body: match.responseBody || '',
        });
      } else {
        unmatchedRequests++;
        // Block unmatched requests by default
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
          totalRecordedRequests: networkLogs.length,
          matchedRequests,
          unmatchedRequests,
          coveragePercentage: networkLogs.length > 0 ? (matchedRequests / networkLogs.length) * 100 : 100,
        },
      };
    }

    return {
      replayMode: 'PROTOCOL',
      success: true,
      stepsReplayed,
      coverage: {
        totalRecordedRequests: networkLogs.length,
        matchedRequests,
        unmatchedRequests,
        coveragePercentage: networkLogs.length > 0 ? (matchedRequests / networkLogs.length) * 100 : 100,
      },
    };
  }

  /**
   * Live Local Replay Mode:
   * Resets local state, runs the agent again against the local page,
   * generates a new trace, and compares it with the source trace.
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
    // 1. Reset local portal database state
    try {
      await fetch(resetStateUrl, { method: 'DELETE' });
    } catch (e) {
      // safe fallback if live server endpoint is not running in test runner
    }

    // 2. Instantiate and execute actual agent run
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

    // 5. Evaluate the new trace
    const evalReport = await EvaluationEngine.evaluateInvoicePolicy(newTraceId);

    // Link replay results in DB
    const replayJob = await prisma.replayJob.create({
      data: {
        replayMode: 'LIVE',
        status: evalReport.passed ? 'COMPLETED' : 'FAILED',
      },
    });

    await prisma.replayResult.create({
      data: {
        replayJobId: replayJob.id,
        traceId: sourceTraceId,
        status: evalReport.passed ? 'COMPLETED' : 'FAILED',
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
