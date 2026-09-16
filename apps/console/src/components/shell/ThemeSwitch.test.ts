import { describe, expect, it } from 'vitest';
import { nextTheme } from './ThemeSwitch.tsx';

describe('theme switching', () => {
  it('changes the visible appearance on every click', () => {
    expect(nextTheme('light', false)).toBe('dark');
    expect(nextTheme('dark', true)).toBe('light');
    expect(nextTheme('system', false)).toBe('dark');
    expect(nextTheme('system', true)).toBe('light');
  });
});
