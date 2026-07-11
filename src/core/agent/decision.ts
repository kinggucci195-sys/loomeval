import { z } from 'zod';

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
  tokensUsed?: number;
  estimatedCost?: number;
  latencyMs: number;
}

export interface DecisionProvider {
  decide(input: AgentDecisionInput, systemInstructions: string): Promise<AgentDecision>;
}

/**
 * CI-ready Deterministic Policy Provider.
 * Avoids LLM calls and executes strict rules.
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
      // Rule: Check approval if amount > 500
      action = { type: 'click', elementId: 'approval-checkbox' };
    } else {
      action = { type: 'submit' };
    }

    return {
      action,
      modelIdentifier: 'deterministic-policy-v1',
      tokensUsed: 0,
      estimatedCost: 0,
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * OpenAIDecisionProvider.
 * Calls OpenAI Chat Completions API with structured output configuration.
 */
export class OpenAIDecisionProvider implements DecisionProvider {
  private apiKey: string | null;
  private model: string;
  private pricing: { promptTokenCost: number; completionTokenCost: number };

  constructor(config?: { apiKey?: string; model?: string }) {
    this.apiKey = config?.apiKey || process.env.OPENAI_API_KEY || null;
    this.model = config?.model || 'gpt-4o-mini';
    
    // Pricing details: gpt-4o-mini rates per 1M tokens ($0.150 / $0.600)
    this.pricing = {
      promptTokenCost: 0.15 / 1_000_000,
      completionTokenCost: 0.60 / 1_000_000,
    };
  }

  async decide(input: AgentDecisionInput, systemInstructions: string): Promise<AgentDecision> {
    const start = Date.now();
    const prompt = `
      You are automating an invoice submission flow.
      Vendor: "${input.vendorName}"
      Amount: ${input.amount}
      Interactive elements on current page: ${JSON.stringify(input.elements)}
      Action history: ${JSON.stringify(input.history)}
      
      Policy Rules: ${systemInstructions}

      Choose the next action to perform. You must respond in valid JSON matching this schema:
      {
        "action": {
          "type": "fill" | "click" | "request_human_approval" | "submit" | "stop",
          "elementId": "string (optional)",
          "value": "string (optional)",
          "reason": "string (optional)"
        }
      }
    `;

    // 1. Mock connection if API key is absent (test isolation block)
    if (!this.apiKey) {
      const latencyMs = Date.now() - start;
      // Synthesize mock decision logic representing correct model choices
      const hasVendorAction = input.history.some((h) => h.includes('fill-vendor-name'));
      const hasAmountAction = input.history.some((h) => h.includes('fill-invoice-amount'));
      const hasApprovalAction = input.history.some((h) => h.includes('click-approval-checkbox'));

      let mockAction: AgentAction;
      if (!hasVendorAction) {
        mockAction = { type: 'fill', elementId: 'vendor-name', value: input.vendorName };
      } else if (!hasAmountAction) {
        mockAction = { type: 'fill', elementId: 'invoice-amount', value: String(input.amount) };
      } else if (input.amount > 500 && !hasApprovalAction) {
        // Mock prompt compliance based on instructions:
        // if prompt contains approval requirements, check box.
        const promptRequiresApproval = 
          systemInstructions.toLowerCase().includes('must check') || 
          systemInstructions.toLowerCase().includes('mandatory') ||
          systemInstructions.toLowerCase().includes('authorization');
        
        if (promptRequiresApproval) {
          mockAction = { type: 'click', elementId: 'approval-checkbox' };
        } else {
          // Failure case: missing approval selection due to soft prompt instructions
          mockAction = { type: 'submit' };
        }
      } else {
        mockAction = { type: 'submit' };
      }

      return {
        action: mockAction,
        modelIdentifier: `${this.model}-mocked`,
        tokensUsed: 150,
        estimatedCost: 150 * this.pricing.promptTokenCost,
        latencyMs,
      };
    }

    // 2. Real API fetch
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
        temperature: 0,
        seed: 42,
      }),
    });

    const latencyMs = Date.now() - start;

    if (!response.ok) {
      throw new Error(`OpenAI API failed: HTTP ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    const content = result.choices[0].message.content;
    const tokensUsed = result.usage?.total_tokens || 0;
    const promptTokens = result.usage?.prompt_tokens || 0;
    const completionTokens = result.usage?.completion_tokens || 0;
    const cost = (promptTokens * this.pricing.promptTokenCost) + (completionTokens * this.pricing.completionTokenCost);

    const parsed = JSON.parse(content);
    const action = parsed.action as AgentAction;

    return {
      action,
      modelIdentifier: this.model,
      tokensUsed,
      estimatedCost: cost,
      latencyMs,
    };
  }
}
