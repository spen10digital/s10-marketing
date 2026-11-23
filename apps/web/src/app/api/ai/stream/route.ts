import { runStudioAction } from '@s10/core/ai';
import { withDbContext } from '@s10/core/db';
import { getBrandBySlug } from '@s10/core/domain';
import { AppError, toErrorResult } from '@s10/core/errors';
import { DECISION_MESSAGES } from '@s10/core/suite';
import { z } from 'zod';
import { getStudioDeps } from '@/server/ai';
import { checkBrandAccess } from '@/server/business';
import { getOrgActorForApi, getOrgContext } from '@/server/org-context';

// Calls Bedrock: Node.js runtime, and long enough for a full Sonnet generation (02 §5, ADR 0017).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const body = z.object({ brandSlug: z.string().min(1).max(64), request: z.unknown() });

/**
 * Streams a Studio / Brand Voice request as NDJSON: `start`, `delta`*, then `done` or `error`.
 * Same-origin JSON only (a cross-site form can't send this content type, and the Origin check
 * covers the rest). The org comes from the session, never from the request.
 */
export async function POST(req: Request): Promise<Response> {
  if (!req.headers.get('content-type')?.startsWith('application/json') || !sameOrigin(req)) {
    return json(403, { ok: false, error: { code: 'FORBIDDEN', message: 'Forbidden.' } });
  }
  const resolved = await getOrgActorForApi({ write: true });
  if (!resolved.ok) {
    if (resolved.reason === 'suite-unavailable') {
      return json(503, {
        ok: false,
        error: {
          code: 'UPSTREAM_UNAVAILABLE',
          message: 'We can’t check your access right now. Please try again shortly.',
        },
      });
    }
    if (resolved.reason === 'no-access' || resolved.reason === 'denied') {
      const message = resolved.suiteReason
        ? DECISION_MESSAGES[resolved.suiteReason]
        : 'S10/Marketing isn’t available for this account.';
      return json(403, { ok: false, error: { code: 'FORBIDDEN', message } });
    }
    return json(401, { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Please sign in again.' } });
  }
  const actor = resolved.actor;

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return json(400, { ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid request.' } });

  const deps = await getStudioDeps();
  const brand = await withDbContext(deps.db, { userId: actor.userId }, (tx) =>
    getBrandBySlug(tx, actor.orgId, parsed.data.brandSlug),
  );
  if (!brand) return json(404, { ok: false, error: { code: 'NOT_FOUND', message: 'Brand not found.' } });
  // The brand is a Suite business: it must be one the Suite lists for this person, and the check runs for it.
  const access = await checkBrandAccess(await getOrgContext(), brand, { write: true });
  if (!access.ok) {
    if (access.reason === 'hidden') {
      return json(404, { ok: false, error: { code: 'NOT_FOUND', message: 'Brand not found.' } });
    }
    if (access.reason === 'suite-unavailable') {
      return json(503, {
        ok: false,
        error: { code: 'UPSTREAM_UNAVAILABLE', message: DECISION_MESSAGES['suite-unavailable'] },
      });
    }
    return json(403, { ok: false, error: { code: 'FORBIDDEN', message: DECISION_MESSAGES[access.reason] } });
  }

  const abort = new AbortController();
  req.signal.addEventListener('abort', () => abort.abort());
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        for await (const event of runStudioAction(deps, actor, brand.id, parsed.data.request, abort.signal)) {
          send(event);
        }
      } catch (err) {
        if (!abort.signal.aborted) send({ type: 'error', ...streamError(err) });
      } finally {
        controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** User-safe error for the stream; upstream details are never sent (05 §2). */
function streamError(err: unknown): { code: string; message: string } {
  if (err instanceof z.ZodError)
    return { code: 'BAD_REQUEST', message: err.issues[0]?.message ?? 'Invalid request.' };
  if (!(err instanceof AppError))
    console.error('ai stream failed', err instanceof Error ? err.name : 'unknown');
  const result = toErrorResult(err);
  return result.ok ? { code: 'INTERNAL', message: 'Something went wrong.' } : result.error;
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  return (
    origin === new URL(req.url).origin ||
    origin === `${req.headers.get('x-forwarded-proto') ?? 'https'}://${req.headers.get('host')}`
  );
}

function json(status: number, data: unknown): Response {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}
