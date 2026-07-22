import { describe, it, expect } from 'vitest';
import { configTemplate } from './configTemplate';

describe('configTemplate', () => {
  it('derives id + name + urlPatterns from the URL host', () => {
    const c = configTemplate('https://jobs.example.com/apply/123?ref=x');
    expect(c.name).toBe('jobs.example.com');
    expect(c.id).toBe('jobs-example-com');
    expect(c.urlPatterns).toEqual(['*://jobs.example.com/*']);
  });

  it('provides an empty extract map and sane defaults', () => {
    const c = configTemplate('https://acme.io/careers');
    expect(c.extract).toEqual({});
    expect(c.autoDetect).toBe(true);
    expect(c.waitFor).toBe('form');
    expect(Array.isArray(c.prep)).toBe(true);
  });

  it('falls back to a generated id when no URL is given', () => {
    const c = configTemplate();
    expect(c.name).toBe('example.com');
    expect(c.urlPatterns).toEqual(['*://example.com/*']);
    expect(c.id.length).toBeGreaterThan(0);
  });

  it('falls back gracefully on an unparseable URL', () => {
    const c = configTemplate('not a url');
    expect(c.name).toBe('example.com');
    expect(c.id).toBeTruthy();
  });
});
