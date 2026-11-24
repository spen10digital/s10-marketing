import { describe, expect, it } from 'vitest';
import { crumbsFor, isCurrent, NAV } from './nav';

describe('sidebar current page', () => {
  it('marks Dashboard for the dashboard and a brand, Studio for the studios', () => {
    expect(isCurrent('/dashboard', '/dashboard')).toBe(true);
    expect(isCurrent('/b/demo', '/dashboard')).toBe(true);
    expect(isCurrent('/b/demo', '/studio')).toBe(false);
    expect(isCurrent('/studio', '/studio')).toBe(true);
    expect(isCurrent('/b/demo/studio', '/studio')).toBe(true);
    expect(isCurrent('/b/demo/studio', '/dashboard')).toBe(false);
  });

  it('lists only this app’s own live pages', () => {
    expect(NAV.map((n) => n.href)).toEqual(['/dashboard', '/studio']);
  });
});

describe('breadcrumbs', () => {
  it('shows names, not ids', () => {
    expect(crumbsFor('/dashboard')).toEqual([
      { label: 'S10/Marketing', href: '/dashboard' },
      { label: 'Dashboard' },
    ]);
    expect(crumbsFor('/b/demo', 'Demo Business').at(-1)).toEqual({ label: 'Demo Business' });
    expect(crumbsFor('/b/demo/studio', 'Demo Business').map((c) => c.label)).toEqual([
      'S10/Marketing',
      'Studio',
      'Demo Business',
    ]);
    expect(crumbsFor('/b/demo')).toHaveLength(3);
    expect(crumbsFor('/somewhere-else')).toHaveLength(1);
  });
});
