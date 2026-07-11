import { prisma } from '../../lib/db';
import { EvaluationEngine } from '../evaluator/engine';

export class ExperimentRunner {
  /**
   * Run a simulation test case variant comparing baseline and candidate prompts.
   */
  static async executeExperimentRun(
    experimentId: string,
    variantPrompt: string,
    variantModel: string
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
        variantPrompt,
        variantModel,
        status: 'RUNNING',
      },
    });

    const testCases = experiment.testSuite.testCases;

    // 2. Iterate through test cases
    for (const testCase of testCases) {
      if (testCase.versions.length === 0) continue;
      const latestVersion = testCase.versions[0];

      // Evaluate the candidate prompt against the test case parameters
      // We mock the execution result based on the variantPrompt:
      // If prompt contains "MUST check", the test passes. If not, it fails.
      const promptPassed = variantPrompt.includes('MUST check');
      
      await prisma.experimentResult.create({
        data: {
          experimentRunId: run.id,
          testCaseVersionId: latestVersion.id,
          passed: promptPassed,
          stepsExecuted: promptPassed ? 5 : 4,
          latencyMs: promptPassed ? 1200 : 1000,
          cost: promptPassed ? 0.05 : 0.04,
          errorDetails: promptPassed 
            ? null 
            : 'Policy Limit Breach: Invoice submitted above $500 without manager approval.',
        },
      });
    }

    // 3. Mark completed
    await prisma.experimentRun.update({
      where: { id: run.id },
      data: { status: 'COMPLETED' },
    });

    return run.id;
  }
}
