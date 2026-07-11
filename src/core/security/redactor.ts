import { prisma } from '../../lib/db';

export interface RedactionRule {
  pattern: string;
  replacement: string;
}

export class Redactor {
  private rules: RedactionRule[] = [
    { pattern: '(?i)bearer\\s+[a-zA-Z0-9_\\-\\.]+', replacement: 'Bearer [REDACTED]' },
    { pattern: '(?i)cookie:\\s+.*', replacement: 'Cookie: [REDACTED]' },
    { pattern: '\\b\\d{4}[- ]?\\d{4}[- ]?\\d{4}[- ]?\\d{4}\\b', replacement: '[REDACTED_CREDIT_CARD]' },
    { pattern: '\\b\\d{3}-\\d{2}-\\d{4}\\b', replacement: '[REDACTED_SSN]' },
  ];

  constructor(customRules?: RedactionRule[]) {
    if (customRules) {
      this.rules = [...this.rules, ...customRules];
    }
  }

  /**
   * Initialize custom redaction rules from DB for tenant workspaces
   */
  static async createForWorkspace(workspaceId: string): Promise<Redactor> {
    // In the MVP, read redaction rules from the DB rules table
    const dbRules = await prisma.redactionRule.findMany();
    const rules = dbRules.map(r => ({
      pattern: r.pattern,
      replacement: r.replacement,
    }));
    return new Redactor(rules);
  }

  /**
   * Scrub sensitive text fields
   */
  redactText(text: string): string {
    let output = text;
    for (const rule of this.rules) {
      try {
        const regex = new RegExp(rule.pattern, 'g');
        output = output.replace(regex, rule.replacement);
      } catch (err) {
        // Safe fallback for invalid regex patterns
      }
    }
    return output;
  }

  /**
   * Redact headers JSON object
   */
  redactHeaders(headersJson: string): string {
    try {
      const headers = JSON.parse(headersJson);
      const redacted: Record<string, string> = {};
      const sensitiveKeys = ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'token'];

      for (const [key, value] of Object.entries(headers)) {
        if (sensitiveKeys.includes(key.toLowerCase())) {
          redacted[key] = '[REDACTED]';
        } else {
          redacted[key] = this.redactText(String(value));
        }
      }
      return JSON.stringify(redacted);
    } catch (e) {
      return this.redactText(headersJson);
    }
  }
}
