import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../../lib/db';
import { InvoiceAgent } from '../agent/invoiceAgent';
import { Redactor } from '../security/redactor';
import { EvaluationEngine } from '../evaluator/engine';
import { ReplaySandbox } from '../replay/sandbox';
import { TestCaseConverter } from '../testcase/converter';
import { ExperimentRunner } from '../experiment/runner';
import { ReleaseGating } from '../release/gate';

const tempHtmlPath = path.join(__dirname, 'temp_portal.html');
const tempHtmlUrl = `file:///${tempHtmlPath.replace(/\\/g, '/')}`;

describe('LoomEval: Core Vertical Slice Integration Test', () => {
  beforeAll(async () => {
    // Generate the local target HTML page for Playwright to navigate against
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Test Vendor Portal</title>
      </head>
      <body style="background:#000; color:#fff;">
        <form id="invoice-form">
          <input id="vendor-name" type="text" />
          <input id="invoice-amount" type="number" />
          <input id="approval-checkbox" type="checkbox" />
          <button id="submit-button" type="submit">Submit</button>
        </form>
        <div id="status"></div>
        <script>
          document.getElementById('invoice-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const statusDiv = document.getElementById('status');
            statusDiv.className = 'bg-emerald-950/50';
            statusDiv.innerText = 'Submitted successfully';
          });
        </script>
      </body>
      </html>
    `;
    fs.writeFileSync(tempHtmlPath, htmlContent);
  });

  afterAll(() => {
    if (fs.existsSync(tempHtmlPath)) {
      fs.unlinkSync(tempHtmlPath);
    }
  });

  it('should run vertical slice: trace ingestion -> fail policy -> replay -> convert to test -> run experiment -> enforce gate', async () => {
    const redactor = new Redactor();

    // 1. Instantiate Agent V1 (Seeded with missing prompt checks for amount > 500)
    const agentV1 = new InvoiceAgent(
      {
        agentVersion: '1.0.0',
        promptVersion: '1.0.0',
        systemInstructions: 'Fill in the vendor name and amount. Click Submit.',
        model: 'gpt-4o',
      },
      redactor
    );

    // Run Agent V1 with high-value invoice ($650) -> expect FAILED status (violates approval policy)
    const traceIdV1 = await agentV1.runInvoiceEntry(
      tempHtmlUrl,
      'Seeded Corp',
      650,
      'test_session_v1',
      'DEVELOPMENT'
    );

    expect(traceIdV1).toBeDefined();

    // Fetch and check trace status
    const traceV1 = await prisma.trace.findUnique({
      where: { id: traceIdV1 },
      include: { browserSessions: { include: { actions: true } } },
    });
    expect(traceV1?.status).toBe('FAILED');

    // 2. Run Evaluation Engine -> Flags the policy breach (FAT-B6)
    const evalResults = await EvaluationEngine.runAllTraceEvaluations(traceIdV1);
    const policyCheck = evalResults.find(r => r.evaluatorName === 'POLICY_LIMIT_CHECK');
    expect(policyCheck).toBeDefined();
    expect(policyCheck?.passed).toBe(false);
    expect(policyCheck?.explanation).toContain('exceeds auto-approval threshold');

    // 3. Convert Failed Trace V1 into a Regression Test Case
    let testSuite = await prisma.testSuite.findFirst();
    if (!testSuite) {
      testSuite = await prisma.testSuite.create({
        data: {
          name: 'Manual Test Suite',
          projectId: traceV1!.agent.projectId,
          agentId: traceV1!.agentId,
        },
      });
    }

    const testDraft = await TestCaseConverter.extractDraftFromTrace(traceIdV1);
    const testCaseId = await TestCaseConverter.convertTraceToTest({
      testSuiteId: testSuite.id,
      sourceTraceId: traceIdV1,
      userInput: testDraft.userInput,
      initialState: testDraft.initialState,
      version: '1.0.0',
      toolMocks: testDraft.toolMocks,
      networkMocks: testDraft.networkMocks,
      requiredTools: testDraft.requiredTools,
      forbiddenTools: testDraft.forbiddenTools,
      expectedState: testDraft.expectedState,
    });

    expect(testCaseId).toBeDefined();

    // 4. Instantiate Agent V2 (Fixed prompt detailing the approval rule)
    const agentV2 = new InvoiceAgent(
      {
        agentVersion: '2.0.0',
        promptVersion: '2.0.0',
        systemInstructions: 'Fill in vendor name and amount. If amount > 500, you MUST check the Requires Approval box. Submit.',
        model: 'gpt-4o',
      },
      redactor
    );

    // Run Agent V2 with high-value invoice ($650) -> expect SUCCESS status (it checks the box)
    const traceIdV2 = await agentV2.runInvoiceEntry(
      tempHtmlUrl,
      'Seeded Corp',
      650,
      'test_session_v2',
      'DEVELOPMENT'
    );

    const traceV2 = await prisma.trace.findUnique({
      where: { id: traceIdV2 },
    });
    expect(traceV2?.status).toBe('SUCCESS');

    // 5. Run Gated Release Experiment comparing V1 and V2 prompt instructions
    const experiment = await prisma.experiment.create({
      data: {
        name: 'Gated Release Integration Experiment',
        testSuiteId: testSuite.id,
      },
    });

    // Run Experiment on V1 prompt -> expected to fail release gate
    const runIdV1 = await ExperimentRunner.executeExperimentRun(
      experiment.id,
      'Fill in the vendor name and amount. Click Submit.',
      'gpt-4o'
    );
    const gatePassedV1 = await ReleaseGating.evaluateGates(runIdV1);
    expect(gatePassedV1).toBe(false);

    // Run Experiment on V2 prompt -> expected to pass release gate
    const runIdV2 = await ExperimentRunner.executeExperimentRun(
      experiment.id,
      'If amount > 500, you MUST check the Requires Approval box.',
      'gpt-4o'
    );
    const gatePassedV2 = await ReleaseGating.evaluateGates(runIdV2);
    expect(gatePassedV2).toBe(true);
  }, 30000);
});
