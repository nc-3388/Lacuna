import { describe, it, expect } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('joins truthy strings with a space', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });

  it('filters out false, null, and undefined', () => {
    expect(cn('a', false, 'b', null, 'c', undefined)).toBe('a b c');
  });

  it('returns an empty string when all parts are falsy', () => {
    expect(cn(false, null, undefined)).toBe('');
  });

  it('handles a single string', () => {
    expect(cn('only')).toBe('only');
  });

  it('returns an empty string with no arguments', () => {
    expect(cn()).toBe('');
  });

  it('preserves conditional class patterns', () => {
    const isActive = true;
    const isDisabled = false;
    expect(cn('base', isActive && 'active', isDisabled && 'disabled')).toBe(
      'base active',
    );
  });
});
