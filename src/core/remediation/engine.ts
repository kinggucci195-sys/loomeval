import { prisma } from '../../lib/db';

export interface RemediationCandidate {
  hypothesis: string;
  evidenceTrace: string;
  targetFailure: string;
  proposedChange: string;
  expectedBenefit: string;
  sideEffects: string;
  requiredTests: string;
  confidence: number;
  diffs: { filePath: string; diffContent: string }[];
}

export class RemediationEngine {
  /**
   * Generates candidate remediations for a specific failure type.
   */
  static generateCandidates(
    failureType: string,
    evidenceDetails: string,
    traceId: string
  ): RemediationCandidate[] {
    const candidates: RemediationCandidate[] = [];

    if (failureType === 'FAT-B6') {
      // 1. Application Code Fix (Hardcoded authorization check)
      candidates.push({
        hypothesis: 'Adding a hardcoded validation guard in the submit handler prevents the agent from violating the approval policy, even if the prompt context drifts.',
        evidenceTrace: `Trace reference: ${traceId}`,
        targetFailure: 'FAT-B6',
        proposedChange: 'Validate amount in browser form onSubmit hook: if amount > 500, check the approval state and throw validation warning if false.',
        expectedBenefit: '100% deterministic safety block. Zero token cost.',
        sideEffects: 'Increases local client code size, requires form refactoring.',
        requiredTests: 'Submit invoice amount of 650 with approval unchecked -> assert warning appears.',
        confidence: 0.95,
        diffs: [
          {
            filePath: 'src/app/demo/invoice-entry/page.tsx',
            diffContent: `@@ -15,5 +15,9 @@
   const handleSubmit = (e) => {
     e.preventDefault();
+    if (parseFloat(amount) > 500 && !requiresApproval) {
+      setError("Invoices above $500 require manager approval.");
+      return;
+    }
     submitInvoice();
   }`,
          },
        ],
      });

      // 2. Prompt Modification (Soft correction)
      candidates.push({
        hypothesis: 'Modifying the system instructions to explicitly detail the $500 threshold forces the LLM router to select the approval step.',
        evidenceTrace: `Trace reference: ${traceId}`,
        targetFailure: 'FAT-B6',
        proposedChange: 'Append manager approval policy parameters to agent prompt instructions.',
        expectedBenefit: 'Resolves issue purely through model steering, no code changes.',
        sideEffects: 'Susceptible to future prompt injections or model degradation. Incur token costs.',
        requiredTests: 'Execute experiment variants against full regression test suite.',
        confidence: 0.75,
        diffs: [
          {
            filePath: 'src/core/agent/prompts/system_prompt.txt',
            diffContent: `@@ -2,2 +2,4 @@
 You are an invoice-entry assistant.
 Fill in the vendor name and total invoice amount.
+CRITICAL: If the invoice amount is greater than 500, you MUST check the 'Requires Approval' box.
`,
          },
        ],
      });
    } else if (failureType === 'FAT-B1') {
      // Selector failure
      candidates.push({
        hypothesis: 'The DOM layout changed dynamic classes. Replacing fragile class selectors with semantic ARIA roles prevents locator breaks.',
        evidenceTrace: `Trace reference: ${traceId}`,
        targetFailure: 'FAT-B1',
        proposedChange: "Use page.getByRole('button', { name: 'Submit' }) instead of page.click('.btn-primary-submit-v2').",
        expectedBenefit: 'High resilience against stylesheet changes and UI refactors.',
        sideEffects: 'Requires elements to adhere to proper accessibility markup.',
        requiredTests: 'Replay browser run in DOM Fixture Replay mode.',
        confidence: 0.9,
        diffs: [
          {
            filePath: 'src/core/agent/invoiceAgent.ts',
            diffContent: `@@ -43,2 +43,2 @@
- await page.click('.btn-primary-submit-v2');
+ await page.getByRole('button', { name: 'Submit' }).click();
`,
          },
         ],
      });
    }

    return candidates;
  }

  /**
   * Generates and logs candidates for a specific trace failure.
   * Returns candidates.
   */
  static async getRemediationsForFailure(traceId: string, failureId: string): Promise<RemediationCandidate[]> {
    const failure = await prisma.failure.findUnique({
      where: { id: failureId },
    });

    if (!failure) return [];

    return this.generateCandidates(failure.failureType, failure.evidence, traceId);
  }
}
