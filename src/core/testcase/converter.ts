import { prisma } from '../../lib/db';

export interface TestCaseInput {
  testSuiteId: string;
  sourceTraceId: string;
  userInput: string;
  initialState: Record<string, any>;
  maxSteps?: number;
  maxCost?: number;
  maxLatencyMs?: number;
  
  // Versioned options
  version: string;
  toolMocks: Record<string, any>;
  networkMocks: Record<string, any>;
  requiredTools: string[];
  forbiddenTools: string[];
  expectedState?: Record<string, any>;
}

export class TestCaseConverter {
  /**
   * Converts a production Trace into a reusable TestCase and TestCaseVersion.
   */
  static async convertTraceToTest(input: TestCaseInput): Promise<string> {
    // 1. Create base TestCase
    const testCase = await prisma.testCase.create({
      data: {
        testSuiteId: input.testSuiteId,
        sourceTraceId: input.sourceTraceId,
        userInput: input.userInput,
        initialState: JSON.stringify(input.initialState),
        maxSteps: input.maxSteps ?? 10,
        maxCost: input.maxCost ?? 5.0,
        maxLatencyMs: input.maxLatencyMs ?? 30000,
      },
    });

    // 2. Create versioned mock fixtures
    const versionRecord = await prisma.testCaseVersion.create({
      data: {
        testCaseId: testCase.id,
        version: input.version,
        toolMocks: JSON.stringify(input.toolMocks),
        networkMocks: JSON.stringify(input.networkMocks),
        requiredTools: JSON.stringify(input.requiredTools),
        forbiddenTools: JSON.stringify(input.forbiddenTools),
        expectedState: input.expectedState ? JSON.stringify(input.expectedState) : null,
      },
    });

    return testCase.id;
  }

  /**
   * Helper to automatically extract parameters from an existing trace
   * and convert it into a draft TestCase configuration.
   */
  static async extractDraftFromTrace(traceId: string): Promise<Omit<TestCaseInput, 'testSuiteId' | 'version'>> {
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
      throw new Error('Trace not found or lacks browser session.');
    }

    const session = trace.browserSessions[0];

    // Extract network exchanges as HAR mock fixtures
    const networkMocks = session.networkLogs.map((log: any) => ({
      url: log.url,
      method: log.method,
      statusCode: log.statusCode,
      responseBody: log.responseBody,
    }));

    // Extract action dependencies
    const requiredTools = session.actions
      .filter((a: any) => a.actionType === 'CLICK' || a.actionType === 'TYPE')
      .map((a: any) => a.selector || 'element');

    return {
      sourceTraceId: traceId,
      userInput: trace.userInput,
      initialState: {
        vendorName: 'Demo Corp',
        amount: 650,
        requiresApproval: false,
      },
      toolMocks: {},
      networkMocks,
      requiredTools,
      forbiddenTools: ['DELETE_BUTTON'],
      expectedState: {
        status: 'SUCCESS',
      },
    };
  }
}
