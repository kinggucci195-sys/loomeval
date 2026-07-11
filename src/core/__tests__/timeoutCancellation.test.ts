import { describe, it, expect, vi } from 'vitest';
import { prisma } from '../../lib/db';
import { InvoiceAgent } from '../agent/invoiceAgent';
import { DeterministicPolicyProvider } from '../agent/decision';
import { chromium } from 'playwright';

// Use vi.hoisted to ensure the mock values are created before vi.mock hoisting
const { mockBrowserClose, mockBrowser } = vi.hoisted(() => {
  const closeFn = vi.fn().mockResolvedValue(undefined);
  const browser = {
    newContext: vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        on: vi.fn(),
        route: vi.fn(),
        goto: vi.fn().mockImplementation(async () => {
          // Simulate a navigation timeout by throwing a Timeout Cancellation error after 500ms
          await new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout Cancellation triggered')), 500)
          );
        }),
        screenshot: vi.fn().mockResolvedValue(Buffer.from('mock-screenshot')),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    close: closeFn,
    version: () => '1.0.0',
  } as any;
  return { mockBrowserClose: closeFn, mockBrowser: browser };
});

vi.mock('playwright', () => {
  return {
    __esModule: true,
    chromium: {
      launch: vi.fn().mockImplementation(async () => {
        return mockBrowser;
      }),
    },
  };
});

vi.mock('playwright-core', () => {
  return {
    __esModule: true,
    chromium: {
      launch: vi.fn().mockImplementation(async () => {
        return mockBrowser;
      }),
    },
  };
});

describe('Timeout Cancellation and Resource Release Suite', () => {
  it('should cleanly cancel browser execution and release resources on timeout', async () => {
    // Setup environment and project
    const workspace = await prisma.workspace.create({
      data: { name: 'Timeout Test Workspace' },
    });
    const project = await prisma.project.create({
      data: { name: 'Timeout Project', workspaceId: workspace.id },
    });
    const env = await prisma.environment.create({
      data: { name: 'DEVELOPMENT', projectId: project.id },
    });

    const agent = await prisma.agent.create({
      data: { name: 'Timeout Agent', projectId: project.id },
    });
    await prisma.agentVersion.create({
      data: { version: '1.0.0', agentId: agent.id, promptSchema: '{}' },
    });

    const agentConfig = {
      agentVersion: '1.0.0',
      promptVersion: '1.0.0',
      systemInstructions: 'Submit details.',
      model: 'deterministic-policy-v1',
      ingestionKey: 'le_test_auth_key',
      environmentId: env.id,
    };

    const invoiceAgent = new InvoiceAgent(agentConfig, new DeterministicPolicyProvider());

    // Run the entry and race against a 1.0s timeout cancellation
    try {
      await Promise.race([
        invoiceAgent.runInvoiceEntry(
          'http://localhost:3000/hanging-page',
          'Test Vendor',
          100,
          `ext_t_${Date.now()}`,
          `sess_${Date.now()}`
        ),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout Cancellation triggered')), 1000)
        ),
      ]);
    } catch (err: any) {
      expect(err.message).toBe('Timeout Cancellation triggered');
    } finally {
      // Verify DB resources clean up
      await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => {});
    }

    // Verify browser close was invoked to prevent orphan processes
    expect(mockBrowserClose).toHaveBeenCalled();
  });
});
