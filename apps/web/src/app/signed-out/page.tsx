import type { Metadata } from 'next';
import { PRODUCT_NAME } from '@s10/core';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Signed out' };

const messages: Record<string, string> = {
  'not-configured': 'Sign-in isn’t configured for this environment yet.',
  unverified: 'Please verify your email address, then sign in again.',
  failed: 'Sign-in didn’t complete. Please try again.',
};

export default async function SignedOutPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const message = error ? (messages[error] ?? messages.failed) : null;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">{PRODUCT_NAME}</CardTitle>
          <CardDescription>{message ?? 'You’re signed out.'}</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <ButtonLink href="/api/auth/login" prefetch={false}>
            Sign in
          </ButtonLink>
          <ButtonLink href="/api/auth/login?screen=signup" prefetch={false} variant="secondary">
            Create account
          </ButtonLink>
        </CardContent>
      </Card>
    </main>
  );
}
