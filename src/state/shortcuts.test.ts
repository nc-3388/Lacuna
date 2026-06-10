import { describe, expect, it } from 'vitest';
import { SHORTCUT_GROUPS } from './shortcuts';

describe('SHORTCUT_GROUPS', () => {
  it('contains at least one group', () => {
    expect(SHORTCUT_GROUPS.length).toBeGreaterThan(0);
  });

  it('each group has a title and shortcuts array', () => {
    for (const group of SHORTCUT_GROUPS) {
      expect(typeof group.title).toBe('string');
      expect(group.title.length).toBeGreaterThan(0);
      expect(Array.isArray(group.shortcuts)).toBe(true);
    }
  });

  it('each shortcut has keys and description', () => {
    for (const group of SHORTCUT_GROUPS) {
      for (const shortcut of group.shortcuts) {
        expect(Array.isArray(shortcut.keys)).toBe(true);
        expect(shortcut.keys.length).toBeGreaterThan(0);
        expect(typeof shortcut.description).toBe('string');
        expect(shortcut.description.length).toBeGreaterThan(0);
      }
    }
  });

  it('has the expected top-level groups', () => {
    const titles = SHORTCUT_GROUPS.map((g) => g.title);
    expect(titles).toContain('Anywhere');
    expect(titles).toContain('Studying');
  });
});
