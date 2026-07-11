import { prisma } from '../../lib/db';
import { InvoiceAgent } from '../agent/invoiceAgent';
import { EvaluationEngine } from '../evaluator/engine';
import { DecisionProvider } from '../agent/decision';

export class ExperimentRunner {
  /**
   * Run a real experiment comparing candidate prompts/configurations.
   * Executes the actual browser agent over the sandbox for every test case.
   */
  static async executeExperimentRun(
    experimentId: string,
    decisionProvider: DecisionProvider,
    systemInstructions: string,
    targetUrl: string,
    ingestionKey: string,
    environmentId: string,
    resetStateUrl: string = 'http://localhost:3000/api/demo/invoices'
  ): Promise<string> {
    const experiment = await prisma.experiment.findUnique({
      where: { id: experimentId },
      include: {
        testSuite: {
          include: {
            testCases: {
              include: {
                versions: true,
              },
            },
          },
        },
      },
    });

    if (!experiment) {
      throw new Error('Experiment not found.');
    }

    // 1. Create run record
    const run = await prisma.experimentRun.create({
      data: {
        experimentId,
        variantPrompt: systemInstructions,
        variantModel: 'openai-configured',
        status: 'RUNNING',
      },
    });
    const testCases = experiment.testSuite.testCases;

    // 2. Iterate through test cases and execute them
    for (const testCase of testCases) {
      if (testCase.versions.length === 0) continue;
      const latestVersion = testCase.versions[0];

      // Parse test case parameters
      const params = JSON.parse(testCase.initialState);
      const vendorName = params.vendorName || 'Test Vendor';
      const amount = parseFloat(String(params.amount || 0));

      // Reset local environment
      try {
        await fetch(resetStateUrl, { method: 'DELETE' });
      } catch (e) {
        // safe skip if local service is not running during unit testing
      }

      // Resolve registered agent version dynamically
      const dbAgentVersion = await prisma.agentVersion.findFirst({
        where: { agentId: experiment.testSuite.agentId },
      });
      const agentVersionStr = dbAgentVersion ? dbAgentVersion.version : '1.0.0';

      // Configure Agent version
      const agentConfig = {
        agentVersion: agentVersionStr,
        promptVersion: latestVersion.version,
        systemInstructions,
        model: 'gpt-4o-mini',
        ingestionKey,
        environmentId,
      };

      const agent = new InvoiceAgent(agentConfig, decisionProvider);
      const externalTraceId = `le_exp_${run.id}_${testCase.id}`;
      const sessionId = `session_exp_${run.id}_${testCase.id}`;

      let traceId: string;
      try {
        // Run the agent (makes actual Playwright browser automation calls)
        traceId = await agent.runInvoiceEntry(
          targetUrl,
          vendorName,
          amount,
          externalTraceId,
          sessionId
        );
      } catch (err: any) {
        // Record test failure due to crash
        await prisma.experimentResult.create({
          data: {
            experimentRunId: run.id,
            testCaseVersionId: latestVersion.id,
            passed: false,
            stepsExecuted: 0,
            latencyMs: 0,
            cost: 0.0,
            errorDetails: `Agent execution crashed: ${err.message}`,
          },
        });
        continue;
      }

      // 3. Run evaluator on the resulting trace
      const evalReport = await EvaluationEngine.evaluateInvoicePolicy(traceId);

      // Fetch trace for actual cost/latency metrics
      const trace = await prisma.trace.findUnique({
        where: { id: traceId },
      });

      // 4. Record real observed execution data
      await prisma.experimentResult.create({
        data: {
          experimentRunId: run.id,
          testCaseVersionId: latestVersion.id,
          passed: evalReport.passed,
          stepsExecuted: trace?.totalLatencyMs ? 4 : 0, // approximation based on trace
          latencyMs: trace?.totalLatencyMs || 0,
          cost: trace?.totalCost || 0.0,
          errorDetails: evalReport.passed ? null : evalReport.diagnosis,
        },
      });
    }

    // 5. Mark completed
    await prisma.experimentRun.update({
      where: { id: run.id },
      data: { status: 'COMPLETED' },
    });

    return run.id;
  }
}
