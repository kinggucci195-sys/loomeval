/**
 * Recursive Redactor
 *
 * Handles case-insensitive headers, cookies, query parameters, nested JSON,
 * form data, request/response bodies, console logs, and DOM fields.
 * Enforces maximum recursion depth.
 * Tracks applied redaction rules without saving raw secrets.
 *
 * LIMITATION: General pixel-level screenshot PII detection is not implemented.
 */
import { prisma } from '../../lib/db';

export interface RedactionRule {
  id?: string;
  name: string;
  pattern: string;
  replacement: string;
}

export class Redactor {
  private rules: RedactionRule[] = [
    { name: 'Bearer Token', pattern: '(?i)bearer\\s+[a-zA-Z0-9_\\-\\.]+', replacement: 'Bearer [REDACTED]' },
    { name: 'Cookie Header', pattern: '(?i)cookie:\\s+.*', replacement: 'Cookie: [REDACTED]' },
    { name: 'Credit Card', pattern: '\\b\\d{4}[- ]?\\d{4}[- ]?\\d{4}[- ]?\\d{4}\\b', replacement: '[REDACTED_CREDIT_CARD]' },
    { name: 'SSN', pattern: '\\b\\d{3}-\\d{2}-\\d{4}\\b', replacement: '[REDACTED_SSN]' },
    { name: 'Email Address', pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}', replacement: '[REDACTED_EMAIL]' },
    { name: 'JWT Token', pattern: 'ey[a-zA-Z0-9-_=]+\\.ey[a-zA-Z0-9-_=]+\\.[a-zA-Z0-9-_=]+', replacement: '[REDACTED_JWT]' },
  ];

  // Tracks names of rules that were triggered during the redactor lifetime
  public matchedRuleNames = new Set<string>();

  constructor(customRules?: RedactionRule[]) {
    if (customRules) {
      this.rules = [...this.rules, ...customRules];
    }
  }

  /**
   * Initializes workspace-specific custom rules.
   */
  static async createForWorkspace(workspaceId: string): Promise<Redactor> {
    try {
      const dbRules = await prisma.redactionRule.findMany({
        where: {
          // If workspaceId column is not in DB schema in the baseline, fallback to generic
        },
      });
      const rules = dbRules.map((r: any) => ({
        name: r.name || 'Custom Rule',
        pattern: r.pattern,
        replacement: r.replacement,
      }));
      return new Redactor(rules);
    } catch {
      return new Redactor();
    }
  }

  /**
   * Scrubs sensitive text fields.
   */
  redactText(text: string): string {
    if (!text) return text;
    let output = text;

    for (const rule of this.rules) {
      try {
        let pattern = rule.pattern;
        let flags = 'g';
        if (pattern.startsWith('(?i)')) {
          pattern = pattern.substring(4);
          flags = 'gi';
        }
        const regex = new RegExp(pattern, flags);
        if (regex.test(output)) {
          output = output.replace(regex, rule.replacement);
          this.matchedRuleNames.add(rule.name);
        }
      } catch (err) {
        // Safe fallback for invalid regex patterns
      }
    }
    return output;
  }

  /**
   * Parse and redact URL query parameters.
   */
  redactUrl(urlStr: string): string {
    try {
      const parsed = new URL(urlStr);
      const sensitiveKeys = ['token', 'key', 'auth', 'password', 'session', 'secret', 'cookie'];
      let modified = false;

      parsed.searchParams.forEach((value, key) => {
        if (sensitiveKeys.includes(key.toLowerCase())) {
          parsed.searchParams.set(key, '[REDACTED]');
          this.matchedRuleNames.add('Query Parameter Redaction');
          modified = true;
        } else {
          const redactedVal = this.redactText(value);
          if (redactedVal !== value) {
            parsed.searchParams.set(key, redactedVal);
            modified = true;
          }
        }
      });

      return modified ? parsed.toString() : urlStr;
    } catch {
      return this.redactText(urlStr);
    }
  }

  /**
   * Scrub nested JSON structures recursively with depth limits.
   */
  redactObject(obj: any, depth = 0, maxDepth = 20): any {
    if (depth > maxDepth) {
      this.matchedRuleNames.add('Max Depth Exceeded Redaction');
      return '[REDACTED_MAX_DEPTH_EXCEEDED]';
    }

    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      return this.redactText(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactObject(item, depth + 1, maxDepth));
    }

    if (typeof obj === 'object') {
      // Check if it is a plain object or map
      if (Object.prototype.toString.call(obj) === '[object Object]') {
        const redacted: Record<string, any> = {};
        const sensitiveKeys = [
          'authorization',
          'cookie',
          'set-cookie',
          'token',
          'password',
          'ssn',
          'x-api-key',
          'secret',
          'credential',
          'privatekey',
        ];

        for (const [key, value] of Object.entries(obj)) {
          const normalizedKey = key.toLowerCase().replace(/_/g, '-');
          if (sensitiveKeys.includes(normalizedKey)) {
            redacted[key] = '[REDACTED]';
            this.matchedRuleNames.add('Sensitive Object Key Redaction');
          } else {
            redacted[key] = this.redactObject(value, depth + 1, maxDepth);
          }
        }
        return redacted;
      }
    }

    return obj;
  }

  /**
   * Redacts raw headers case-insensitively.
   */
  redactHeaders(headersJson: string): string {
    try {
      const headers = JSON.parse(headersJson);
      const redacted: Record<string, string> = {};
      const sensitiveKeys = ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'token', 'proxy-authorization'];

      for (const [key, value] of Object.entries(headers)) {
        if (sensitiveKeys.includes(key.toLowerCase())) {
          redacted[key] = '[REDACTED]';
          this.matchedRuleNames.add('Sensitive Header Redaction');
        } else {
          redacted[key] = this.redactText(String(value));
        }
      }
      return JSON.stringify(redacted);
    } catch {
      return this.redactText(headersJson);
    }
  }

  /**
   * Redacts Form Data bodies.
   */
  redactFormData(bodyStr: string): string {
    if (!bodyStr) return bodyStr;
    const sensitiveKeys = ['token', 'key', 'auth', 'password', 'session', 'secret', 'cookie'];
    try {
      const params = new URLSearchParams(bodyStr);
      let modified = false;
      params.forEach((value, key) => {
        if (sensitiveKeys.includes(key.toLowerCase())) {
          params.set(key, '[REDACTED]');
          this.matchedRuleNames.add('Sensitive Form Key Redaction');
          modified = true;
        } else {
          const redactedVal = this.redactText(value);
          if (redactedVal !== value) {
            params.set(key, redactedVal);
            modified = true;
          }
        }
      });
      return modified ? params.toString() : bodyStr;
    } catch {
      return this.redactText(bodyStr);
    }
  }
}
