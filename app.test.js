// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatSimTime, escapeHtml } from './components/utils.js';

describe('App Presentation Layer Utilities', () => {
  it('should escape HTML correctly for building names', () => {
    const dangerousString = '<script>alert("xss")</script> & quotes';
    const escaped = escapeHtml(dangerousString);
    
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');
    expect(escaped).toContain('&amp; quotes');
  });
  
  it('should format simulation time correctly', () => {
    expect(formatSimTime(10.5)).toBe('10:30 AM');
    expect(formatSimTime(13.0)).toBe('1:00 PM');
    expect(formatSimTime(0.25)).toBe('12:15 AM');
    expect(formatSimTime(23.75)).toBe('11:45 PM');
  });
});
