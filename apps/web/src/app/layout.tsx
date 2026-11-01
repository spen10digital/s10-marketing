import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PRODUCT_NAME } from '@s10/core';
import './globals.css';

export const metadata: Metadata = {
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description: 'AI-assisted marketing and social publishing for S10 brands.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
