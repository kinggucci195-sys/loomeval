import { prisma } from '../../lib/db';

export class ReleaseGating {
  /**
   * Evaluates if a given experiment run satisfies project release gates.
   */
  static async evaluateGates(experimentRunId: string): Promise<boolean> {
    const run = await prisma.experimentRun.findUnique({
      where: { id: experimentRunId },
      include: {
        results: true,
      },
    });

    if (!run) {
      throw new Error('Experiment run not found');
    }

    const results = run.results;
    if (results.length === 0) {
      return false;
    }

    // Thresholds
    const minPassRate = 1.0; // 100% pass required for promotion
    const maxLatencyLimit = 5000; // 5 seconds max latency
    const maxCostLimit = 1.0; // $1.00 max cost per session

    // Calculate metrics
    const totalCount = results.length;
    const passedCount = results.filter((r) => r.passed).length;
    const passRate = passedCount / totalCount;
    const avgLatency = results.reduce((acc, r) => acc + r.latencyMs, 0) / totalCount;
    const avgCost = results.reduce((acc, r) => acc + r.cost, 0) / totalCount;

    const passRateCheck = passRate >= minPassRate;
    const latencyCheck = avgLatency <= maxLatencyLimit;
    const costCheck = avgCost <= maxCostLimit;

    // Create ReleaseGateResult entry
    await prisma.releaseGateResult.create({
      data: {
        experimentRunId,
        gateName: 'PASS_RATE_GATE',
        passed: passRateCheck,
        observedValue: `${(passRate * 100).toFixed(1)}%`,
        thresholdValue: `${(minPassRate * 100).toFixed(1)}%`,
      },
    });

    await prisma.releaseGateResult.create({
      data: {
        experimentRunId,
        gateName: 'LATENCY_GATE',
        passed: latencyCheck,
        observedValue: `${avgLatency.toFixed(0)}ms`,
        thresholdValue: `${maxLatencyLimit}ms`,
      },
    });

    return passRateCheck && latencyCheck && costCheck;
  }
}
