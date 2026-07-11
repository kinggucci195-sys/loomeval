import { z } from 'zod';
import * as crypto from 'crypto';
import { AppError } from '../errors/errors';

export type AgentAction =
  | { type: 'fill'; elementId: string; value: string }
  | { type: 'click'; elementId: string }
  | { type: 'request_human_approval'; reason: string }
  | { type: 'submit' }
  | { type: 'stop'; reason: string };

export interface AgentDecisionInput {
  vendorName: string;
  amount: number;
  history: string[];
  elements: { id: string; role: string; name: string; value?: string }[];
}

export interface AgentDecision {
  action: AgentAction;
  modelIdentifier: string;
  tokensUsed: number;
  estimatedCost: number;
  latencyMs: number;
  responseHash: string;
}

export interface DecisionProvider {
  decide(input: AgentDecisionInput, systemInstructions: string): Promise<AgentDecision>;
}

// ── Strict Action Zod Schema ──────────────────────────────────────────────────
export const ActionZodSchema = z.object({
  action: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('fill'),
      elementId: z.string(),
      value: z.string(),
    }),
    z.object({
      type: z.literal('click'),
      elementId: z.string(),
    }),
    z.object({
      type: z.literal('request_human_approval'),
      reason: z.string(),
    }),
    z.object({
      type: z.literal('submit'),
    }),
    z.object({
      type: z.literal('stop'),
      reason: z.string(),
    }),
  ]),
});

/**
 * Deterministic Policy Provider (For consistent CI runs and quick replay).
 */
export class DeterministicPolicyProvider implements DecisionProvider {
  private approvalThreshold = 500;

  async decide(input: AgentDecisionInput, systemInstructions: string): Promise<AgentDecision> {
    const start = Date.now();
    const hasVendorAction = input.history.some((h) => h.includes('fill-vendor-name'));
    const hasAmountAction = input.history.some((h) => h.includes('fill-invoice-amount'));
    const hasApprovalAction = input.history.some((h) => h.includes('click-approval-checkbox'));

    let action: AgentAction;

    if (!hasVendorAction) {
      action = { type: 'fill', elementId: 'vendor-name', value: input.vendorName };
    } else if (!hasAmountAction) {
      action = { type: 'fill', elementId: 'invoice-amount', value: String(input.amount) };
    } else if (input.amount > this.approvalThreshold && !hasApprovalAction) {
      action = { type: 'click', elementId: 'approval-checkbox' };
    } else {
      action = { type: 'submit' };
    }

    const latencyMs = Date.now() - start;
    const rawContent = JSON.stringify(action);
    const responseHash = crypto.createHash('sha256').update(rawContent).digest('hex');

    return {
      action,
      modelIdentifier: 'deterministic-policy-v1',
      tokensUsed: 0,
      estimatedCost: 0,
      latencyMs,
      responseHash,
    };
  }
}

/**
 * OpenAIDecisionProvider with structured schema enforcement, timeout-retries,
 * costing tables, and error classification.
 */
export class OpenAIDecisionProvider implements DecisionProvider {
  private apiKey: string | null;
  private model: string;
  private temperature: number;
  private seed: number;
  private pricing: { promptTokenCost: number; completionTokenCost: number };

  constructor(config?: { apiKey?: string; model?: string; temperature?: number; seed?: number }) {
    this.apiKey = config?.apiKey || process.env.OPENAI_API_KEY || null;
    this.model = config?.model || 'gpt-4o-mini';
    this.temperature = config?.temperature ?? 0;
    this.seed = config?.seed ?? 42;

    // Pricing gpt-4o-mini rates
    this.pricing = {
      promptTokenCost: 0.15 / 1_000_000,
      completionTokenCost: 0.6 / 1_000_000,
    };
  }

  async decide(input: AgentDecisionInput, systemInstructions: string): Promise<AgentDecision> {
    const start = Date.now();

    // Enforce opt-in for live tests
    const runLive = process.env.RUN_LIVE_MODEL_TESTS === 'true';

    if (!this.apiKey || !runLive) {
      // Return deterministic mock payload representing agent progress
      const latencyMs = Date.now() - start;
      const hasVendorAction = input.history.some((h) => h.includes('fill-vendor-name'));
      const hasAmountAction = input.history.some((h) => h.includes('fill-invoice-amount'));
      const hasApprovalAction = input.history.some((h) => h.includes('click-approval-checkbox'));

      let mockAction: AgentAction;
      if (!hasVendorAction) {
        mockAction = { type: 'fill', elementId: 'vendor-name', value: input.vendorName };
      } else if (!hasAmountAction) {
        mockAction = { type: 'fill', elementId: 'invoice-amount', value: String(input.amount) };
      } else if (input.amount > 500 && !hasApprovalAction) {
        const requiresApproval =
          systemInstructions.toLowerCase().includes('must check') ||
          systemInstructions.toLowerCase().includes('mandatory') ||
          systemInstructions.toLowerCase().includes('authorization');
        mockAction = requiresApproval
          ? { type: 'click', elementId: 'approval-checkbox' }
          : { type: 'submit' };
      } else {
        mockAction = { type: 'submit' };
      }

      const rawContent = JSON.stringify(mockAction);
      const responseHash = crypto.createHash('sha256').update(rawContent).digest('hex');

      return {
        action: mockAction,
        modelIdentifier: `${this.model}-mocked`,
        tokensUsed: 150,
        estimatedCost: 150 * this.pricing.promptTokenCost,
        latencyMs,
        responseHash,
      };
    }

    const prompt = `
      Choose the next action to perform. You must respond in valid JSON matching this schema:
      {
        "action": {
          "type": "fill" | "click" | "request_human_approval" | "submit" | "stop",
          "elementId": "string (optional)",
          "value": "string (optional)",
          "reason": "string (optional)"
        }
      }
      Vendor: "${input.vendorName}"
      Amount: ${input.amount}
      Interactive elements: ${JSON.stringify(input.elements)}
      History: ${JSON.stringify(input.history)}
    `;

    // Timeout and bounded retry implementation
    let attempts = 0;
    const maxAttempts = 3;
    let lastError: any = null;

    while (attempts < maxAttempts) {
      attempts++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: 'system', content: systemInstructions },
              { role: 'user', content: prompt },
            ],
            response_format: { type: 'json_object' },
            temperature: this.temperature,
            seed: this.seed,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          if (response.status === 429) {
            throw new AppError({
              code: 'PROVIDER_RATE_LIMITED',
              message: 'OpenAI API rate limit exceeded',
              status: 429,
            });
          }
          if (response.status >= 500) {
            throw new AppError({
              code: 'PROVIDER_SERVER_ERROR',
              message: `OpenAI API server error: HTTP ${response.status}`,
              status: 502,
            });
          }
          throw new AppError({
            code: 'PROVIDER_SERVER_ERROR',
            message: `OpenAI API failed: HTTP ${response.status}`,
            status: 500,
          });
        }

        const result = await response.json();
        const content = result.choices?.[0]?.message?.content;
        if (!content) {
          throw new AppError({
            code: 'PROVIDER_MALFORMED_RESPONSE',
            message: 'OpenAI returned an empty choice list',
            status: 502,
          });
        }

        // Validate structure with Zod schema
        let parsed: any;
        try {
          parsed = JSON.parse(content);
        } catch {
          throw new AppError({
            code: 'PROVIDER_MALFORMED_RESPONSE',
            message: 'Failed to parse OpenAI response content as JSON',
            status: 502,
          });
        }

        const validation = ActionZodSchema.safeParse(parsed);
        if (!validation.success) {
          throw new AppError({
            code: 'PROVIDER_MALFORMED_RESPONSE',
            message: `OpenAI response failed schema validation: ${JSON.stringify(validation.error.format())}`,
            status: 502,
          });
        }

        const tokensUsed = result.usage?.total_tokens || 0;
        const promptTokens = result.usage?.prompt_tokens || 0;
        const completionTokens = result.usage?.completion_tokens || 0;
        const cost =
          promptTokens * this.pricing.promptTokenCost +
          completionTokens * this.pricing.completionTokenCost;

        const responseHash = crypto.createHash('sha256').update(content).digest('hex');
        const latencyMs = Date.now() - start;

        return {
          action: validation.data.action,
          modelIdentifier: this.model,
          tokensUsed,
          estimatedCost: cost,
          latencyMs,
          responseHash,
        };
      } catch (err: any) {
        clearTimeout(timeoutId);
        lastError = err;
        if (err.name === 'AbortError') {
          lastError = new AppError({
            code: 'PROVIDER_TIMEOUT',
            message: 'Request to OpenAI provider timed out after 10s',
            status: 504,
          });
        }
        // Delay before retry
        await new Promise((res) => setTimeout(res, 500 * attempts));
      }
    }

    throw new AppError({
      code: 'PROVIDER_RETRY_EXHAUSTED',
      message: `OpenAI request failed after ${maxAttempts} attempts: ${lastError.message}`,
      status: 502,
      cause: lastError,
    });
  }
}
