import { describe, it, expect } from 'vitest';
import { currentFormFactor } from './formFactor';

describe('currentFormFactor', () => {
  it('trusts userAgentData.mobile when the browser reports it', () => {
    expect(currentFormFactor({ userAgentData: { mobile: true }, userAgent: 'X11; Linux' })).toBe('mobile');
    expect(currentFormFactor({ userAgentData: { mobile: false }, userAgent: 'Android Mobile' })).toBe('desktop');
  });

  it('falls back to the user-agent string', () => {
    expect(currentFormFactor({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile Safari' })).toBe('mobile');
    expect(currentFormFactor({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)' })).toBe('desktop');
  });

  it('is desktop when nothing can be read', () => {
    expect(currentFormFactor(undefined)).toBe('desktop');
    expect(currentFormFactor({})).toBe('desktop');
  });
});
