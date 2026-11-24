import { describe, expect, it } from 'vitest';
import { brandHref, brandSlugOf, roleLabel } from './workspace-nav';

describe('workspace switcher helpers', () => {
  it('finds the brand in the URL, or none on Dashboard and Studio', () => {
    expect(brandSlugOf('/b/acme')).toBe('acme');
    expect(brandSlugOf('/b/acme/studio')).toBe('acme');
    expect(brandSlugOf('/dashboard')).toBeUndefined();
    expect(brandSlugOf('/studio')).toBeUndefined();
  });

  it('keeps you in the studio when you switch brand there, else opens the brand page', () => {
    expect(brandHref('/b/acme/studio', 'zed')).toBe('/b/zed/studio');
    expect(brandHref('/studio', 'zed')).toBe('/b/zed/studio');
    expect(brandHref('/b/acme', 'zed')).toBe('/b/zed');
    expect(brandHref('/dashboard', 'zed')).toBe('/b/zed');
  });

  it('shows the role as a label', () => {
    expect(roleLabel('owner')).toBe('Owner');
    expect(roleLabel('viewer')).toBe('Viewer');
  });
});
