const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding LoomEval Database (CommonJS)...');

  // 1. Clean Database (Reverse dependency order)
  await prisma.canaryObservation.deleteMany();
  await prisma.deployment.deleteMany();
  await prisma.release.deleteMany();
  await prisma.releaseGateResult.deleteMany();
  await prisma.approval.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.workspaceMember.deleteMany();
  await prisma.ingestionKey.deleteMany();
  await prisma.replayResult.deleteMany();
  await prisma.replayJob.deleteMany();
  await prisma.experimentResult.deleteMany();
  await prisma.experimentRun.deleteMany();
  await prisma.experiment.deleteMany();
  await prisma.testCaseVersion.deleteMany();
  await prisma.testCase.deleteMany();
  await prisma.testSuite.deleteMany();
  await prisma.failure.deleteMany();
  await prisma.browserAction.deleteMany();
  await prisma.pageSnapshot.deleteMany();
  await prisma.networkExchange.deleteMany();
  await prisma.traceStep.deleteMany();
  await prisma.browserSession.deleteMany();
  await prisma.trace.deleteMany();
  await prisma.incidentEvent.deleteMany();
  await prisma.incident.deleteMany();
  await prisma.toolVersion.deleteMany();
  await prisma.tool.deleteMany();
  await prisma.promptVersion.deleteMany();
  await prisma.prompt.deleteMany();
  await prisma.agentVersion.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.environment.deleteMany();
  await prisma.project.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();

  // 2. Create Base Users & Workspace
  const user = await prisma.user.create({
    data: {
      email: 'founder@loomeval.com',
      name: 'Founding Engineer',
    },
  });

  const workspace = await prisma.workspace.create({
    data: {
      name: 'Acme Operations',
    },
  });

  await prisma.workspaceMember.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      role: 'ADMIN',
    },
  });

  const project = await prisma.project.create({
    data: {
      name: 'Invoice Automation',
      workspaceId: workspace.id,
    },
  });

  // 3. Create Environments
  const prodEnv = await prisma.environment.create({
    data: { name: 'PRODUCTION', projectId: project.id },
  });
  const stagingEnv = await prisma.environment.create({
    data: { name: 'STAGING', projectId: project.id },
  });
  const devEnv = await prisma.environment.create({
    data: { name: 'DEVELOPMENT', projectId: project.id },
  });

  // 4. Create Ingestion Key (Hashed)
  const rawKey = 'le_ingest_75f3a098ce1b4a39b2cd8e41';
  const hashedKey = crypto.createHash('sha256').update(rawKey).digest('hex');
  await prisma.ingestionKey.create({
    data: {
      projectId: project.id,
      keyPrefix: 'le_ingest_',
      hashedKey,
      scope: 'INGEST',
    },
  });

  // 5. Create Agent & 3 Versions
  const agent = await prisma.agent.create({
    data: {
      name: 'Billing Entry Bot',
      projectId: project.id,
    },
  });

  const v1 = await prisma.agentVersion.create({
    data: { agentId: agent.id, version: '1.0.0', promptSchema: '{}' },
  });
  const v2 = await prisma.agentVersion.create({
    data: { agentId: agent.id, version: '1.1.0', promptSchema: '{}' },
  });
  const v3 = await prisma.agentVersion.create({
    data: { agentId: agent.id, version: '1.2.0', promptSchema: '{}' },
  });

  // Create Prompts & Versions
  const prompt = await prisma.prompt.create({ data: { name: 'Billing System Instructions' } });
  const p1 = await prisma.promptVersion.create({
    data: {
      promptId: prompt.id,
      version: '1.0.0',
      content: 'Fill in the vendor name and amount. Click Submit.',
      agentVersionId: v1.id,
    },
  });
  const p2 = await prisma.promptVersion.create({
    data: {
      promptId: prompt.id,
      version: '1.1.0',
      content: 'Fill in vendor name and amount. If amount > 500, check the Requires Approval box. Submit.',
      agentVersionId: v2.id,
    },
  });
  const p3 = await prisma.promptVersion.create({
    data: {
      promptId: prompt.id,
      version: '1.2.0',
      content: 'Strictly check Requires Approval box for any order amount exceeding $500 before form submission.',
      agentVersionId: v3.id,
    },
  });

  // Create Tools & Versions
  const tool = await prisma.tool.create({ data: { name: 'SubmitInvoiceAPI' } });
  await prisma.toolVersion.create({
    data: {
      toolId: tool.id,
      version: '1.0.0',
      schema: '{}',
      agentVersionId: v1.id,
    },
  });
  await prisma.toolVersion.create({
    data: {
      toolId: tool.id,
      version: '1.1.0',
      schema: '{}',
      agentVersionId: v2.id,
    },
  });

  // 6. Generate 75 Traces (55 successful, 20 failed)
  const incident = await prisma.incident.create({
    data: {
      title: 'FAT-B6: Runaway Policy Violations on High-Value Invoices',
      severity: 'HIGH',
      status: 'OPEN',
      rootCause: 'Agent version 1.0.0 lacks prompt instructions regarding approval checkboxes.',
      mitigation: 'Upgrade prompt to version 1.2.0.',
    },
  });

  console.log('Generating 75 trace histories...');
  for (let i = 1; i <= 75; i++) {
    const isFailure = i <= 20; // First 20 are seeded failures
    const amount = isFailure ? 550 + (i * 10) : 100 + (i * 5);
    const status = isFailure ? 'FAILED' : 'SUCCESS';

    const trace = await prisma.trace.create({
      data: {
        sessionId: `session_uuid_${i}`,
        agentId: agent.id,
        agentVersionId: isFailure ? v1.id : v2.id,
        environmentId: prodEnv.id,
        userInput: `Log invoice for Acme Corp, amount $${amount}`,
        finalOutput: isFailure ? 'Policy validation failed' : 'Submitted successfully',
        status,
        totalCost: 0.05,
        totalLatencyMs: 1500,
        incidentId: isFailure ? incident.id : null,
      },
    });

    // Create steps
    await prisma.traceStep.create({
      data: {
        traceId: trace.id,
        name: 'RETRIEVE',
        status: 'SUCCESS',
        input: '{}',
        output: '{}',
      },
    });

    const step2 = await prisma.traceStep.create({
      data: {
        traceId: trace.id,
        name: 'TOOL_CALL',
        status: isFailure ? 'ERROR' : 'SUCCESS',
        input: JSON.stringify({ actionType: 'SUBMIT', amount }),
        output: '{}',
      },
    });

    // Create browser session logs
    const session = await prisma.browserSession.create({
      data: {
        traceId: trace.id,
        browserVersion: 'Chromium 124',
        viewportWidth: 1280,
        viewportHeight: 720,
        userAgent: 'Mozilla/5.0 Playwright Agent',
      },
    });

    await prisma.browserAction.create({
      data: {
        browserSessionId: session.id,
        actionType: 'NAVIGATE',
        url: 'http://localhost:3000/demo/invoice-entry',
      },
    });

    await prisma.browserAction.create({
      data: {
        browserSessionId: session.id,
        actionType: 'TYPE',
        selector: '#vendor-name',
        inputValue: 'Acme Corp',
      },
    });

    await prisma.browserAction.create({
      data: {
        browserSessionId: session.id,
        actionType: 'TYPE',
        selector: '#invoice-amount',
        inputValue: String(amount),
      },
    });

    await prisma.browserAction.create({
      data: {
        browserSessionId: session.id,
        actionType: 'SUBMIT',
        selector: '#submit-button',
      },
    });

    await prisma.pageSnapshot.create({
      data: {
        browserSessionId: session.id,
        url: 'http://localhost:3000/demo/invoice-entry',
        domContent: '<html><body>Mock DOM</body></html>',
        accessibilityTree: '[]',
      },
    });

    // Seed Failure details if FAILED
    if (isFailure) {
      await prisma.failure.create({
        data: {
          traceId: trace.id,
          failureType: 'FAT-B6',
          firstBadStep: step2.id,
          diagnosis: `Invoice of $${amount} submitted without manager approval, violating FAT-B6 safety threshold.`,
          evidence: JSON.stringify({ amount, requiresApproval: false }),
        },
      });
    }
  }

  // 7. Create Test Suite & 25 Regression Cases
  console.log('Seeding test suites & 25 test cases...');
  const suite = await prisma.testSuite.create({
    data: {
      name: 'Invoice Regression Suite',
      projectId: project.id,
      agentId: agent.id,
    },
  });

  for (let t = 1; t <= 25; t++) {
    const amount = 550 + (t * 5);
    const test = await prisma.testCase.create({
      data: {
        testSuiteId: suite.id,
        userInput: `Log invoice for Acme, amount $${amount}`,
        initialState: JSON.stringify({ vendorName: 'Acme Corp', amount }),
      },
    });

    await prisma.testCaseVersion.create({
      data: {
        testCaseId: test.id,
        version: '1.0.0',
        toolMocks: '{}',
        networkMocks: '[]',
        requiredTools: '["#vendor-name", "#invoice-amount", "#submit-button"]',
        forbiddenTools: '["#delete-invoice"]',
        expectedState: '{"status":"SUCCESS"}',
      },
    });
  }

  // 8. Create Experiments & 4 Variants
  console.log('Creating 4 experiment variants...');
  const experiment = await prisma.experiment.create({
    data: {
      name: 'Approval Threshold Fix Validation',
      testSuiteId: suite.id,
    },
  });

  const variants = [
    { name: 'Baseline V1 (No policy rules)', prompt: p1.content },
    { name: 'V2 (Soft Prompt Instructions)', prompt: p2.content },
    { name: 'V3 (Strict Prompt Instructions)', prompt: p3.content },
    { name: 'V4 (Graph-level Hard Coded Checks)', prompt: p3.content + ' AND Hardcoded validation guard.' },
  ];

  for (let idx = 0; idx < variants.length; idx++) {
    const v = variants[idx];
    const run = await prisma.experimentRun.create({
      data: {
        experimentId: experiment.id,
        variantPrompt: v.prompt,
        variantModel: 'gpt-4o',
        status: 'COMPLETED',
      },
    });

    // Seed results (V3 & V4 pass, V1 fails, V2 fails)
    const passed = idx >= 2;
    const testCases = await prisma.testCase.findMany({ where: { testSuiteId: suite.id }, include: { versions: true } });

    for (const testCase of testCases) {
      await prisma.experimentResult.create({
        data: {
          experimentRunId: run.id,
          testCaseVersionId: testCase.versions[0].id,
          passed,
          stepsExecuted: passed ? 5 : 4,
          latencyMs: passed ? 1200 : 1000,
          cost: passed ? 0.05 : 0.04,
          errorDetails: passed ? null : 'Failed: Invoice amount above $500 submitted without approval check.',
        },
      });
    }

    // Evaluate release gates
    const gateResult = await prisma.releaseGateResult.create({
      data: {
        experimentRunId: run.id,
        gateName: 'PASS_RATE_GATE',
        passed,
        observedValue: passed ? '100%' : '0%',
        thresholdValue: '100%',
      },
    });

    // 9. Seed Releases & Canary History
    if (idx === 1) {
      // V2 Failed Canary release followed by rollback
      const approval = await prisma.approval.create({
        data: {
          approvedById: user.id,
          status: 'APPROVED',
          notes: 'Attempting V2 soft-prompt release.',
        },
      });

      const release = await prisma.release.create({
        data: {
          version: '1.1.0',
          agentVersionId: v2.id,
          environmentId: prodEnv.id,
          releaseGateResultId: gateResult.id,
          approvalId: approval.id,
          status: 'ROLLED_BACK',
          trafficPercent: 0,
          rollbackReason: 'High-value policy leakage alert triggered during canary execution.',
        },
      });

      await prisma.canaryObservation.create({
        data: {
          releaseId: release.id,
          errorRate: 0.12, // 12% failed runs
          avgCost: 0.06,
          avgLatency: 1100,
        },
      });
    } else if (idx === 2) {
      // V3 Successful Canary release promoted to production
      const approval = await prisma.approval.create({
        data: {
          approvedById: user.id,
          status: 'APPROVED',
          notes: 'V3 strict prompt changes pass all gates.',
        },
      });

      const release = await prisma.release.create({
        data: {
          version: '1.2.0',
          agentVersionId: v3.id,
          environmentId: prodEnv.id,
          releaseGateResultId: gateResult.id,
          approvalId: approval.id,
          status: 'PRODUCTION',
          trafficPercent: 100,
        },
      });

      await prisma.canaryObservation.create({
        data: {
          releaseId: release.id,
          errorRate: 0.0, // 0% errors in canary
          avgCost: 0.05,
          avgLatency: 1200,
        },
      });
    }
  }

  // 10. Audit Events log
  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      actorType: 'USER',
      action: 'RELEASE_PROMOTE',
      description: 'Promoted Agent Version 1.2.0 to 100% PRODUCTION after successful canary execution metrics.',
    },
  });

  console.log('Database seeded successfully (CommonJS)!');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
