import type { Metadata } from 'next';
import { Comfortaa, Inter, JetBrains_Mono } from 'next/font/google';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { PRODUCT_NAME } from '@s10/core';
import { readPrefs, themeAttributes } from '@/lib/theme';
import { cookieNames } from '@/server/auth/cookies';
import { getConfig } from '@/server/config';
import './globals.css';

// The S10 fonts, exposed under the variable names @spen10digital/s10-ui reads.
const inter = Inter({ variable: '--s10-font-inter', subsets: ['latin'], display: 'swap' });
// Comfortaa is only for app names, so it is not preloaded on every page.
const comfortaa = Comfortaa({
  variable: '--s10-font-comfortaa',
  weight: ['700'],
  subsets: ['latin'],
  display: 'swap',
  preload: false,
});
const jetbrainsMono = JetBrains_Mono({
  variable: '--s10-font-jetbrains-mono',
  subsets: ['latin'],
  display: 'swap',
  preload: false,
});

export const metadata: Metadata = {
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description: 'AI-assisted marketing and social publishing for S10 brands.',
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The theme and light/dark the person chose in any S10 app (kept by the Suite, mirrored in a cookie).
  // Without the cookie the default theme follows the browser's light or dark setting.
  const secure = (await getConfig()).APP_URL.startsWith('https://');
  const look = readPrefs((await cookies()).get(cookieNames(secure).prefs)?.value);
  return (
    <html
      lang="en"
      {...themeAttributes(look?.theme, look && look.mode !== 'system' ? look.mode : undefined)}
      className={`${inter.variable} ${comfortaa.variable} ${jetbrainsMono.variable}`}
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}
