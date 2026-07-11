export function validateSelector(selector: string): void {
  const allowedSelectors = [
    '#vendor-name',
    '#invoice-amount',
    '#approval-checkbox',
    '#submit-button',
  ];
  if (!allowedSelectors.includes(selector)) {
    throw new Error(`Security Violation: Disallowed selector '${selector}'`);
  }
}

export function validateUrl(url: string): void {
  if (url.startsWith('file:///')) {
    return;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        return;
      }
    }
  } catch (e) {
    // Treat invalid URL as security violation
  }
  throw new Error(`Security Violation: Disallowed URL '${url}'`);
}
