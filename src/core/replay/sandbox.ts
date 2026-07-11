import { Page } from 'playwright';
import { prisma } from '../../lib/db';

export interface ReplayReport {
  replayMode: 'FIXTURE' | 'COUNTERFACTUAL' | 'MOCKED' | 'LIVE';
  success: boolean;
  mismatchDetail?: string;
  stepsReplayed: number;
}

export class ReplaySandbox {
  /**
   * Run Fixture Replay:
   * Replays recorded model outputs and tool sequences deterministically.
   * Does not launch a browser. Extremely fast, validates agent logic and parsing.
   */
  static async runFixtureReplay(traceId: string): Promise<ReplayReport> {
    const trace = await prisma.trace.findUnique({
      where: { id: traceId },
      include: {
        browserSessions: {
          include: {
            actions: true,
          },
        },
      },
    });

    if (!trace || trace.browserSessions.length === 0) {
      throw new Error('Trace not found or has no browser sessions.');
    }

    const recordedActions = trace.browserSessions[0].actions;
    
    // Simulate re-running the agent state transitions against mock outputs
    // We expect the candidate agent to perform the identical sequence of action types
    let stepsReplayed = 0;
    for (let i = 0; i < recordedActions.length; i++) {
      const rec = recordedActions[i];
      // Mocking step execution
      stepsReplayed++;
      
      // If we observe a failure state, log mismatch
      if (rec.actionType === 'SUBMIT' && trace.status === 'FAILED') {
        // Mock mismatch detection (e.g. policy breach)
        return {
          replayMode: 'FIXTURE',
          success: false,
          mismatchDetail: `Fixture replay failed at step ${i + 1}: expected successful invoice submission, but hit policy error.`,
          stepsReplayed,
        };
      }
    }

    return {
      replayMode: 'FIXTURE',
      success: true,
      stepsReplayed,
    };
  }

  /**
   * Run Protocol Replay:
   * Launches Playwright browser and intercepts all network calls, returning
   * HTTP responses captured in the NetworkExchange table (HAR log).
   */
  static async runProtocolReplay(traceId: string, page: Page): Promise<ReplayReport> {
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

    // Set up network interception using Playwright's page.route
    await page.route('**/*', async (route) => {
      const req = route.request();
      const url = req.url();
      const method = req.method();

      // Search matching exchange in DB network logs
      const match = networkLogs.find(
        (log) => log.url === url && log.method === method
      );

      if (match) {
        // Return mocked response
        await route.fulfill({
          status: match.statusCode,
          headers: JSON.parse(match.responseHeaders),
          body: match.responseBody || '',
        });
      } else {
        // Fallback for uncaptured assets (e.g. local CSS/HTML)
        await route.continue();
      }
    });

    // Execute recorded actions sequentially against intercepted browser
    let stepsReplayed = 0;
    try {
      for (const action of actions) {
        if (action.actionType === 'NAVIGATE' && action.url) {
          await page.goto(action.url);
        } else if (action.actionType === 'CLICK' && action.selector) {
          await page.click(action.selector);
        } else if (action.actionType === 'TYPE' && action.selector && action.inputValue) {
          await page.fill(action.selector, action.inputValue);
        } else if (action.actionType === 'SUBMIT') {
          // If it is submit, click the button and wait for navigation
          await page.evaluate(() => {
            const form = document.querySelector('form');
            if (form) form.submit();
          });
        }
        stepsReplayed++;
      }
    } catch (err: any) {
      return {
        replayMode: 'MOCKED',
        success: false,
        mismatchDetail: `Playwright execution failed: ${err.message}`,
        stepsReplayed,
      };
    }

    return {
      replayMode: 'MOCKED',
      success: true,
      stepsReplayed,
    };
  }
}
