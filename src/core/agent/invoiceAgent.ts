import { chromium } from 'playwright';
import { prisma } from '../../lib/db';
import { Redactor } from '../security/redactor';

export interface AgentConfig {
  agentVersion: string;
  promptVersion: string;
  systemInstructions: string;
  model: string;
}

export class InvoiceAgent {
  private config: AgentConfig;
  private redactor: Redactor;

  constructor(config: AgentConfig, redactor: Redactor) {
    this.config = config;
    this.redactor = redactor;
  }

  /**
   * Run the browser agent workflow using Playwright.
   * Takes a local HTML file path or live URL as target.
   */
  async runInvoiceEntry(
    targetUrl: string,
    vendorName: string,
    amount: number,
    sessionId: string,
    environmentName: 'PRODUCTION' | 'STAGING' | 'DEVELOPMENT' = 'DEVELOPMENT'
  ): Promise<string> {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Trace capture objects
    const actionsLogged: {
      actionType: string;
      selector?: string;
      url?: string;
      inputValue?: string;
      coordinatesX?: number;
      coordinatesY?: number;
    }[] = [];
    
    const exchangesLogged: {
      url: string;
      method: string;
      requestHeaders: string;
      requestBody?: string;
      responseHeaders: string;
      responseBody?: string;
      statusCode: number;
      latencyMs: number;
    }[] = [];

    // Intercept network
    page.on('requestfinished', async (request) => {
      try {
        const response = await request.response();
        if (response) {
          exchangesLogged.push({
            url: request.url(),
            method: request.method(),
            requestHeaders: JSON.stringify(request.headers()),
            requestBody: request.postData() || undefined,
            responseHeaders: JSON.stringify(response.headers()),
            responseBody: request.url().endsWith('.html') ? undefined : await response.text(),
            statusCode: response.status(),
            latencyMs: 10, // Simulated network time
          });
        }
      } catch (err) {
        // Safe skip on connection closures
      }
    });

    // 1. Navigate to Portal
    actionsLogged.push({ actionType: 'NAVIGATE', url: targetUrl });
    await page.goto(targetUrl);

    // 2. Extract DOM & Screenshots
    const initialHtml = await page.content();

    // 3. Fill Vendor Name
    actionsLogged.push({
      actionType: 'TYPE',
      selector: '#vendor-name',
      inputValue: vendorName,
    });
    await page.fill('#vendor-name', vendorName);

    // 4. Fill Invoice Amount
    actionsLogged.push({
      actionType: 'TYPE',
      selector: '#invoice-amount',
      inputValue: String(amount),
    });
    await page.fill('#invoice-amount', String(amount));

    // 5. Policy Decision: Should we check the approval checkbox?
    // We mock the decision block based on systemInstructions (Prompt Version)
    const isOverLimit = amount > 500;
    const shouldCheckApproval = 
      isOverLimit && this.config.systemInstructions.includes('MUST check');

    // In Agent V1, the prompt is bugged/ambiguous ("check if needed" instead of "MUST check"),
    // so shouldCheckApproval will evaluate to false, creating the policy failure!
    if (shouldCheckApproval) {
      actionsLogged.push({
        actionType: 'CLICK',
        selector: '#approval-checkbox',
      });
      await page.click('#approval-checkbox');
    }

    // 6. Submit form
    actionsLogged.push({
      actionType: 'SUBMIT',
      selector: '#submit-button',
    });
    
    // Screenshot before submit
    const screenshotBuffer = await page.screenshot({ type: 'png' });
    
    await Promise.all([
      page.click('#submit-button'),
      page.waitForTimeout(500), // Allow form response to render
    ]);

    // Check terminal output state
    const successBox = await page.$('.bg-emerald-950\\/50');
    const status = (successBox && !isOverLimit) || (successBox && isOverLimit && shouldCheckApproval) 
      ? 'SUCCESS' 
      : 'FAILED';

    const finalOutput = await page.content();
    await browser.close();

    // --- Persist the Ingested Trace ---
    // Find or create workspace & projects
    let workspace = await prisma.workspace.findFirst();
    if (!workspace) {
      workspace = await prisma.workspace.create({ data: { name: 'Default Workspace' } });
    }

    let project = await prisma.project.findFirst({ where: { workspaceId: workspace.id } });
    if (!project) {
      project = await prisma.project.create({
        data: { name: 'E-Commerce Billing', workspaceId: workspace.id },
      });
    }

    let env = await prisma.environment.findFirst({
      where: { projectId: project.id, name: environmentName },
    });
    if (!env) {
      env = await prisma.environment.create({
        data: { name: environmentName, projectId: project.id },
      });
    }

    let agent = await prisma.agent.findFirst({ where: { projectId: project.id } });
    if (!agent) {
      agent = await prisma.agent.create({
        data: { name: 'Invoice Agent', projectId: project.id },
      });
    }

    let agentVer = await prisma.agentVersion.findFirst({
      where: { agentId: agent.id, version: this.config.agentVersion },
    });
    if (!agentVer) {
      agentVer = await prisma.agentVersion.create({
        data: {
          agentId: agent.id,
          version: this.config.agentVersion,
          promptSchema: '{}',
        },
      });
    }

    // Create prompt version links
    const prompt = await prisma.prompt.create({ data: { name: 'System Instructions' } });
    await prisma.promptVersion.create({
      data: {
        promptId: prompt.id,
        version: this.config.promptVersion,
        content: this.config.systemInstructions,
        agentVersionId: agentVer.id,
      },
    });

    // Create trace record
    const trace = await prisma.trace.create({
      data: {
        sessionId,
        agentId: agent.id,
        agentVersionId: agentVer.id,
        environmentId: env.id,
        userInput: `Submit invoice for ${vendorName} amount ${amount}`,
        finalOutput: status === 'SUCCESS' ? 'Submitted successfully' : 'Policy validation failed',
        status,
      },
    });

    // Create trace step spans
    for (const action of actionsLogged) {
      await prisma.traceStep.create({
        data: {
          traceId: trace.id,
          name: action.actionType === 'NAVIGATE' ? 'RETRIEVE' : 'TOOL_CALL',
          status: 'SUCCESS',
          input: JSON.stringify(action),
          output: '{}',
        },
      });
    }

    // Create browser session logs
    const browserSession = await prisma.browserSession.create({
      data: {
        traceId: trace.id,
        browserVersion: 'Chromium 124',
        viewportWidth: 1280,
        viewportHeight: 720,
        userAgent: 'Mozilla/5.0 Playwright Agent',
      },
    });

    // Persist browser actions
    for (const action of actionsLogged) {
      await prisma.browserAction.create({
        data: {
          browserSessionId: browserSession.id,
          actionType: action.actionType,
          selector: action.selector,
          inputValue: action.inputValue ? this.redactor.redactText(action.inputValue) : undefined,
          url: action.url,
        },
      });
    }

    // Persist page snapshots
    await prisma.pageSnapshot.create({
      data: {
        browserSessionId: browserSession.id,
        url: targetUrl,
        domContent: initialHtml,
        accessibilityTree: '[]',
      },
    });

    // Persist network exchanges
    for (const ex of exchangesLogged) {
      await prisma.networkExchange.create({
        data: {
          browserSessionId: browserSession.id,
          url: ex.url,
          method: ex.method,
          requestHeaders: this.redactor.redactHeaders(ex.requestHeaders),
          requestBody: ex.requestBody ? this.redactor.redactText(ex.requestBody) : undefined,
          responseHeaders: this.redactor.redactHeaders(ex.responseHeaders),
          responseBody: ex.responseBody ? this.redactor.redactText(ex.responseBody) : undefined,
          statusCode: ex.statusCode,
          latencyMs: ex.latencyMs,
        },
      });
    }

    return trace.id;
  }
}
