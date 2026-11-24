import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

// The shared switcher is a client component from the private UI kit; the test replaces it with a
// plain function so the component's own output (the props it hands over) can be read directly.
vi.mock('@spen10digital/s10-ui/client', () => ({ WorkspaceSwitcher: () => null }));
vi.mock('next/link', () => ({ default: () => null }));

const nav = vi.hoisted(() => ({ pathname: '/dashboard', push: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push }),
}));

import { BrandWorkspaceSwitcher } from './workspace-switcher';

const brands = [
  { slug: 'acme', name: 'Acme' },
  { slug: 'globex', name: 'Globex' },
];

type SwitcherProps = {
  current: { id: string; name: string; subtitle: string };
  workspaces: { id: string; name: string; subtitle: string }[];
  action: { label: string; href: string };
  onSelect: (id: string) => void;
};

function render(props: Partial<Parameters<typeof BrandWorkspaceSwitcher>[0]> = {}) {
  const el = BrandWorkspaceSwitcher({
    brands,
    roleLabel: 'Owner',
    newWorkspaceHref: 'https://suite.example/businesses/new',
    ...props,
  }) as ReactElement<SwitcherProps> | null;
  return el;
}

describe('BrandWorkspaceSwitcher', () => {
  beforeEach(() => {
    nav.pathname = '/dashboard';
    nav.push.mockClear();
  });

  it('renders nothing when the person has no brands', () => {
    expect(render({ brands: [] })).toBeNull();
  });

  it('lists "All brands" first, then each brand, all with the role as subtitle', () => {
    const p = render()!.props;
    expect(p.workspaces).toEqual([
      { id: '__all__', name: 'All brands', subtitle: 'Owner' },
      { id: 'acme', name: 'Acme', subtitle: 'Owner' },
      { id: 'globex', name: 'Globex', subtitle: 'Owner' },
    ]);
  });

  it('shows "All brands" as current when no brand is in the URL', () => {
    expect(render()!.props.current.id).toBe('__all__');
  });

  it('shows the brand named in the URL as current', () => {
    nav.pathname = '/b/globex/studio';
    expect(render()!.props.current.name).toBe('Globex');
  });

  it('falls back to "All brands" for a brand slug that is not in the list', () => {
    nav.pathname = '/b/not-mine';
    expect(render()!.props.current.id).toBe('__all__');
  });

  it('sends "New workspace" to the Suite', () => {
    expect(render()!.props.action).toEqual({
      label: 'New workspace',
      href: 'https://suite.example/businesses/new',
    });
  });

  it('navigates by URL: a brand from the dashboard, its studio from a studio, back to /dashboard for all', () => {
    render()!.props.onSelect('acme');
    expect(nav.push).toHaveBeenLastCalledWith('/b/acme');

    nav.pathname = '/b/acme/studio';
    render()!.props.onSelect('globex');
    expect(nav.push).toHaveBeenLastCalledWith('/b/globex/studio');

    render()!.props.onSelect('__all__');
    expect(nav.push).toHaveBeenLastCalledWith('/dashboard');
  });
});
