import { prisma } from '../../lib/db';

export interface GateRule {
  minPassRate: number; // e.g. 1.0 (100% pass)
  maxAllowedLatencyMs: number; // max latency ceiling
  maxAllowedCost: number; // max cost ceiling
  maxCostRegressionPercent?: number; // e.g. 10 (10% max cost increase over baseline)
  maxLatencyRegressionPercent?: number; // e.g. 15 (15% max latency increase over baseline)
}

export class ReleaseGating {
  /**
   * Evaluates if a candidate experiment run passes release gating policy.
   * Compares the candidate run against an optional baseline run to detect regressions.
   */
  static async evaluateGates(
    candidateRunId: string,
    rules: GateRule,
    baselineRunId?: string
  ): Promise<boolean> {
    const candidateRun = await prisma.experimentRun.findUnique({
      where: { id: candidateRunId },
      include: { results: true },
    });

    if (!candidateRun || candidateRun.results.length === 0) {
      throw new Error('Candidate experiment run not found or has no results');
    }

    const candidateResults = candidateRun.results;
    const totalTests = candidateResults.length;
    const passedTests = candidateResults.filter((r) => r.passed).length;
    const candidatePassRate = passedTests / totalTests;
    
    const avgCandidateLatency = candidateResults.reduce((sum, r) => sum + r.latencyMs, 0) / totalTests;
    const avgCandidateCost = candidateResults.reduce((sum, r) => sum + r.cost, 0) / totalTests;

    let passRateGate = candidatePassRate >= rules.minPassRate;
    let latencyGate = avgCandidateLatency <= rules.maxAllowedLatencyMs;
    let costGate = avgCandidateCost <= rules.maxAllowedCost;

    let costRegressionGate = true;
    let latencyRegressionGate = true;

    // 1. Run Baseline Regression Comparison
    if (baselineRunId) {
      const baselineRun = await prisma.experimentRun.findUnique({
        where: { id: baselineRunId },
        include: { results: true },
      });

      if (baselineRun && baselineRun.results.length > 0) {
        const baselineResults = baselineRun.results;
        const totalBase = baselineResults.length;
        const avgBaseLatency = baselineResults.reduce((sum, r) => sum + r.latencyMs, 0) / totalBase;
        const avgBaseCost = baselineResults.reduce((sum, r) => sum + r.cost, 0) / totalBase;

        if (rules.maxCostRegressionPercent && avgBaseCost > 0) {
          const costIncrease = ((avgCandidateCost - avgBaseCost) / avgBaseCost) * 100;
          costRegressionGate = costIncrease <= rules.maxCostRegressionPercent;
        }

        if (rules.maxLatencyRegressionPercent && avgBaseLatency > 0) {
          const latencyIncrease = ((avgCandidateLatency - avgBaseLatency) / avgBaseLatency) * 100;
          latencyRegressionGate = latencyIncrease <= rules.maxLatencyRegressionPercent;
        }
      }
    }

    // A single critical check failure blocks the release immediately
    const overallPassed =
      passRateGate &&
      latencyGate &&
      costGate &&
      costRegressionGate &&
      latencyRegressionGate;

    // 2. Persist Gate Results
    await prisma.releaseGateResult.create({
      data: {
        experimentRunId: candidateRunId,
        gateName: 'PASS_RATE_GATE',
        passed: passRateGate,
        observedValue: `${(candidatePassRate * 100).toFixed(1)}%`,
        thresholdValue: `${(rules.minPassRate * 100).toFixed(1)}%`,
      },
    });

    await prisma.releaseGateResult.create({
      data: {
        experimentRunId: candidateRunId,
        gateName: 'LATENCY_GATE',
        passed: latencyGate,
        observedValue: `${avgCandidateLatency.toFixed(0)}ms`,
        thresholdValue: `${rules.maxAllowedLatencyMs}ms`,
      },
    });

    await prisma.releaseGateResult.create({
      data: {
        experimentRunId: candidateRunId,
        gateName: 'COST_GATE',
        passed: costGate,
        observedValue: `$${avgCandidateCost.toFixed(4)}`,
        thresholdValue: `$${rules.maxAllowedCost.toFixed(4)}`,
      },
    });

    if (baselineRunId) {
      await prisma.releaseGateResult.create({
        data: {
          experimentRunId: candidateRunId,
          gateName: 'COST_REGRESSION_GATE',
          passed: costRegressionGate,
          observedValue: 'Compared to baseline',
          thresholdValue: rules.maxCostRegressionPercent ? `${rules.maxCostRegressionPercent}%` : 'N/A',
        },
      });
    }

    return overallPassed;
  }
}
