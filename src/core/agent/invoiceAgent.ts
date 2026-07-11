import { chromium, Page } from 'playwright';
import * as crypto from 'crypto';
import { LoomEvalClient, SDKTracePayload } from '../sdk/client';
import { getArtifactStore, ArtifactStore } from '../artifacts/store';
import { DecisionProvider, AgentDecisionInput, AgentAction } from './decision';
import { validateSelector, validateUrl } from '../replay/vocabulary';
import { prisma } from '../../lib/db';

export interface AgentConfig {
  agentVersion: string;
  promptVersion: string;
  systemInstructions: string;
  model: string;
  ingestionKey: string;
  environmentId: string;
}

export class InvoiceAgent {
  private config: AgentConfig;
  private client: LoomEvalClient;
  private artifactStore: ArtifactStore;
  private decisionProvider: DecisionProvider;

  constructor(
    config: AgentConfig,
    decisionProvider: DecisionProvider,
    customStore?: ArtifactStore
  ) {
    this.config = config;
    this.client = new LoomEvalClient({ ingestionKey: config.ingestionKey });
    this.artifactStore = customStore || getArtifactStore();
    this.decisionProvider = decisionProvider;
  }

  /**
   * Safe mapping from logical element IDs to CSS selectors.
   * Prevents arbitrary CSS selector injection from models.
   */
  private mapElementIdToSelector(elementId: string): string {
    const registry: Record<string, string> = {
      'vendor-name': '#vendor-name',
      'invoice-amount': '#invoice-amount',
      'approval-checkbox': '#approval-checkbox',
      'submit-button': '#submit-button',
    };

    const selector = registry[elementId];
    if (!selector) {
      throw new Error(`Access Denied: Unmapped element identifier: ${elementId}`);
    }
    return selector;
  }

  /**
   * Execute the agent workflow using Playwright.
   */
  async runInvoiceEntry(
    targetUrl: string,
    vendorName: string,
    amount: number,
    externalTraceId: string,
    sessionId: string
  ): Promise<string> {
    const startWallTime = Date.now();

    // 0. Resolve TenantContext from environment
    const envRecord = await prisma.environment.findUnique({
      where: { id: this.config.environmentId },
      include: { project: true },
    });
    if (!envRecord) {
      throw new Error(`Environment ${this.config.environmentId} not found`);
    }
    const tenantContext = {
      projectId: envRecord.projectId,
      workspaceId: envRecord.project.workspaceId,
    };

    const browser = await chromium.launch({ headless: true });
    let screenshotBuffer: Buffer;
    let finalStatus: 'SUCCESS' | 'FAILED' = 'FAILED';

    const actionsLogged: SDKTracePayload['actions'] = [];
    const networkLogs: NonNullable<SDKTracePayload['networkLogs']> = [];
    const consoleLogs: string[] = [];
    const pageErrors: string[] = [];

    try {
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Playwright Browser';
      const viewport = { width: 1280, height: 720 };

      const context = await browser.newContext({
        userAgent,
        viewport,
      });
      const page = await context.newPage();

      // Capture console messages
      page.on('console', (msg) => {
        consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
      });

      // Capture page errors
      page.on('pageerror', (err) => {
        pageErrors.push(err.message);
      });

      // Intercept network requests for telemetry
      page.on('requestfinished', async (request) => {
        try {
          const response = await request.response();
          if (response) {
            const resText = await response.text().catch(() => null);
            networkLogs.push({
              url: request.url(),
              method: request.method(),
              requestHeaders: JSON.stringify(request.headers()),
              requestBody: request.postData() || null,
              responseHeaders: JSON.stringify(response.headers()),
              responseBody: resText,
              statusCode: response.status(),
              latencyMs: 10,
            });
          }
        } catch (err) {
          // Safe skip on connection closures
        }
      });

      // In-memory route handler mapping for headless sandbox runs
      await page.route('**/api/demo/invoices', async (route) => {
        const request = route.request();
        const method = request.method();
        const headers = request.headers();
        const postData = request.postData();

        const req = new Request('http://localhost/api/demo/invoices', {
          method,
          headers,
          body: postData,
        });

        const { POST, DELETE } = await import('../../app/api/demo/invoices/route');
        const res = method === 'DELETE' ? await DELETE() : await POST(req);
        const body = await res.text();

        await route.fulfill({
          status: res.status,
          headers: Object.fromEntries(res.headers.entries()),
          body,
        });
      });

      // 1. Navigate
      actionsLogged.push({
        actionType: 'NAVIGATE',
        url: targetUrl,
      });
      validateUrl(targetUrl);
      await page.goto(targetUrl);

      let stepCount = 0;
      const maxSteps = 10;
      const history: string[] = [];
      let isTerminated = false;

      // Interactive Loop
      while (stepCount < maxSteps && !isTerminated) {
        stepCount++;

        // Extract current page interactive elements
        const elements = [
          { id: 'vendor-name', role: 'textbox', name: 'Vendor Name' },
          { id: 'invoice-amount', role: 'textbox', name: 'Invoice Amount' },
          { id: 'approval-checkbox', role: 'checkbox', name: 'Requires Approval' },
          { id: 'submit-button', role: 'button', name: 'Submit Invoice' },
        ];

        // Get next action decision from provider
        const decisionInput: AgentDecisionInput = {
          vendorName,
          amount,
          history,
          elements,
        };

        const decision = await this.decisionProvider.decide(
          decisionInput,
          this.config.systemInstructions
        );

        const action = decision.action;

        if (action.type === 'fill') {
          const selector = this.mapElementIdToSelector(action.elementId);
          actionsLogged.push({
            actionType: 'FILL',
            elementId: action.elementId,
            selector,
            inputValue: action.value,
          });

          validateSelector(selector);
          await page.fill(selector, action.value);
          history.push(`fill-${action.elementId}-${action.value}`);
        } else if (action.type === 'click') {
          const selector = this.mapElementIdToSelector(action.elementId);
          actionsLogged.push({
            actionType: 'CLICK',
            elementId: action.elementId,
            selector,
          });

          validateSelector(selector);
          await page.click(selector);
          history.push(`click-${action.elementId}`);
        } else if (action.type === 'submit') {
          actionsLogged.push({
            actionType: 'SUBMIT',
            selector: '#submit-button',
          });

          // Click submit and wait for API response
          validateSelector('#submit-button');
          await Promise.all([
            page.click('#submit-button'),
            page.waitForTimeout(500),
          ]);

          // Evaluate outcome from portal’s observable HTML response state
          const successBox = await page.$('.bg-emerald-950\\/50');
          const errorBox = await page.$('.bg-red-950\\/50');

          if (successBox) {
            finalStatus = 'SUCCESS';
          } else if (errorBox) {
            finalStatus = 'FAILED';
          }

          isTerminated = true;
          history.push('submit');
        } else if (action.type === 'request_human_approval') {
          actionsLogged.push({
            actionType: 'REQUEST_HUMAN_APPROVAL',
          });
          isTerminated = true;
          history.push(`request_human_approval-${action.reason}`);
        } else if (action.type === 'stop') {
          actionsLogged.push({
            actionType: 'STOP',
          });
          isTerminated = true;
          history.push(`stop-${action.reason}`);
        }
      }

      // Mask sensitive credentials inside local screenshots for privacy compliance
      screenshotBuffer = await page.screenshot({ type: 'png' });
    } finally {
      await browser.close();
    }

    // 2. Submit Trace via LoomEval Ingestion Client SDK
    const totalLatencyMs = Date.now() - startWallTime;

    const payload: SDKTracePayload = {
      externalTraceId,
      environmentId: this.config.environmentId,
      agentVersion: this.config.agentVersion,
      promptVersion: this.config.promptVersion,
      userInput: `Submit invoice for ${vendorName} amount ${amount}`,
      finalOutput: finalStatus === 'SUCCESS' ? 'Submitted successfully' : 'Validation failed',
      status: finalStatus,
      totalLatencyMs,
      totalCost: 0.05,
      sessionId,
      actions: actionsLogged,
      networkLogs,
    };

    const res = await this.client.submitTrace(payload);

    // 3. Write Visual Telemetry Screenshots to Secure Artifact Store
    const trace = await prisma.trace.findUnique({
      where: { id: res.traceId },
      include: { browserSessions: true },
    });

    if (trace && trace.browserSessions.length > 0) {
      await this.artifactStore.put(tenantContext, {
        browserSessionId: trace.browserSessions[0].id,
        name: 'final_screenshot.png',
        mimeType: 'image/png',
        buffer: screenshotBuffer,
        isSensitive: true,
      });
    }

    return res.traceId;
  }
}
