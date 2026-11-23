/**
 * Pure helpers for the workspace switcher (no React, so they are unit tested). In S10/Marketing a
 * workspace is a brand, which is a Suite business. The brand in use comes from the URL
 * (/b/<slug> and /b/<slug>/studio); on Dashboard and Studio no brand is chosen yet.
 */

/** The brand URL name in a path, or undefined when no brand is chosen (Dashboard, Studio, ...). */
export function brandSlugOf(pathname: string): string | undefined {
  return /^\/b\/([^/]+)/.exec(pathname)?.[1];
}

/** Where picking a brand leads: its studio when you are in a studio, else the brand page. */
export function brandHref(pathname: string, slug: string): string {
  const inStudio = pathname === '/studio' || /^\/b\/[^/]+\/studio(\/|$)/.test(pathname);
  return inStudio ? `/b/${slug}/studio` : `/b/${slug}`;
}

/** The "no brand chosen" entry: picking it returns to the account-wide Dashboard. */
export const ALL_BRANDS_ID = '__all__';

/** A person's role in the organization as a label for the switcher's second line. */
export function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
