import 'server-only';
import { AppError, createLogger } from '@s10/core';
import { NextResponse, type NextRequest } from 'next/server';
import { clearAuthCookies } from './flow';

const log = createLogger().child({ component: 'auth' });

/**
 * Auth failures land on /signed-out with a short reason code; details stay in the logs (with
 * redaction) and are never echoed to the browser.
 */
export function authErrorResponse(err: unknown, request: NextRequest): NextResponse {
  const code = err instanceof AppError ? err.code : 'INTERNAL';
  log.warn('auth flow failed', { code, path: request.nextUrl.pathname, err });
  const url = new URL('/signed-out', request.nextUrl.origin);
  url.searchParams.set(
    'error',
    code === 'CONFIG_INVALID' ? 'not-configured' : code === 'FORBIDDEN' ? 'unverified' : 'failed',
  );
  const response = NextResponse.redirect(url);
  clearAuthCookies(response);
  return response;
}
