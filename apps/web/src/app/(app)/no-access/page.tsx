import type { Metadata } from 'next';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DECISION_MESSAGES, type DenialReason } from '@s10/core/suite';
import { getCognitoSettings } from '@/server/auth/cognito';
import { getOrgContext } from '@/server/org-context';

export const metadata: Metadata = { title: 'No access' };
export const dynamic = 'force-dynamic';

/**
 * Where a person lands when S10/Marketing is not usable for them right now: the Suite cannot be
 * reached (nothing is allowed, fail closed), the Suite refused the sign-in, or none of their
 * accounts has S10/Marketing turned on for them.
 */
export default async function NoAccessPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const [{ suite, orgs }, settings, { reason }] = await Promise.all([
    getOrgContext(),
    getCognitoSettings(),
    searchParams,
  ]);
  const denied = reason && reason in DECISION_MESSAGES ? DECISION_MESSAGES[reason as DenialReason] : null;
  const message = denied
    ? denied
    : suite === 'suite-unavailable'
      ? 'We can’t reach S10/Suite to check your access, so S10/Marketing is paused. Please try again shortly.'
      : suite === 'suite-refused'
        ? 'S10/Suite didn’t accept your sign-in. Please sign in again.'
        : orgs.length === 0
          ? 'S10/Marketing isn’t turned on for any of your accounts or businesses yet. Add it in S10/Suite, then come back.'
          : 'You’re all set.';

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">S10/Marketing isn’t available</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <ButtonLink href={settings.suiteUrl} prefetch={false}>
            Open S10/Suite
          </ButtonLink>
          <ButtonLink href="/dashboard" variant="secondary">
            Try again
          </ButtonLink>
        </CardContent>
      </Card>
    </div>
  );
}
