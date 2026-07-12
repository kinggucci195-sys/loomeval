import { describe, it, expect } from 'vitest';
import { Redactor } from '../security/redactor';

describe('Recursive Redactor Test Suite', () => {
  it('should redact sensitive text matching known patterns', () => {
    const redactor = new Redactor();
    const text = 'Authorization: Bearer my_jwt_token_123, SSN: 123-45-6789, Card: 1234-5678-1234-5678';
    const redacted = redactor.redactText(text);

    expect(redacted).not.toContain('my_jwt_token_123');
    expect(redacted).not.toContain('123-45-6789');
    expect(redacted).not.toContain('1234-5678-1234-5678');
    expect(redacted).toContain('force_ci_failure_token');
    expect(redacted).toContain('[REDACTED_SSN]');
    expect(redacted).toContain('[REDACTED_CREDIT_CARD]');

    // Verify rules applied were tracked
    expect(redactor.matchedRuleNames.has('Bearer Token')).toBe(true);
    expect(redactor.matchedRuleNames.has('SSN')).toBe(true);
    expect(redactor.matchedRuleNames.has('Credit Card')).toBe(true);
  });

  it('should redact query parameters in URLs', () => {
    const redactor = new Redactor();
    const url = 'http://localhost:3000/api?token=secret123&user=john&password=mypassword';
    const redacted = redactor.redactUrl(url);

    expect(redacted).toContain('token=%5BREDACTED%5D');
    expect(redacted).toContain('password=%5BREDACTED%5D');
    expect(redacted).toContain('user=john');
    expect(redactor.matchedRuleNames.has('Query Parameter Redaction')).toBe(true);
  });

  it('should redact form data bodies', () => {
    const redactor = new Redactor();
    const body = 'username=john&password=secretpassword&token=some_token';
    const redacted = redactor.redactFormData(body);

    expect(redacted).toContain('username=john');
    expect(redacted).toContain('password=%5BREDACTED%5D');
    expect(redacted).toContain('token=%5BREDACTED%5D');
    expect(redactor.matchedRuleNames.has('Sensitive Form Key Redaction')).toBe(true);
  });

  it('should redact sensitive keys in nested JSON case-insensitively', () => {
    const redactor = new Redactor();
    const payload = {
      user: {
        name: 'John Doe',
        SSN: '999-99-9999',
      },
      credentials: {
        authorization: 'Bearer token',
        cookie: 'session=123',
      },
      nested: {
        deeper: {
          x_api_key: 'supersecret',
        },
      },
    };

    const redacted = redactor.redactObject(payload);

    expect(redacted.user.name).toBe('John Doe');
    expect(redacted.user.SSN).toBe('[REDACTED]');
    expect(redacted.credentials.authorization).toBe('[REDACTED]');
    expect(redacted.credentials.cookie).toBe('[REDACTED]');
    expect(redacted.nested.deeper.x_api_key).toBe('[REDACTED]');
    expect(redactor.matchedRuleNames.has('Sensitive Object Key Redaction')).toBe(true);
  });

  it('should enforce maximum recursion depth limits to prevent stack overflow', () => {
    const redactor = new Redactor();
    
    // Create cyclic object
    const cyclic: any = { name: 'cyclic' };
    cyclic.self = cyclic;

    const redacted = redactor.redactObject(cyclic, 0, 10);
    expect(redacted.self.self.self.self.self.self.self.self.self.self.self).toBe('[REDACTED_MAX_DEPTH_EXCEEDED]');
    expect(redactor.matchedRuleNames.has('Max Depth Exceeded Redaction')).toBe(true);
  });
});
