// Liveness only: must not touch the database, so it never wakes a paused Aurora cluster (05 §6.2).
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { ok: true, version: process.env.APP_VERSION ?? 'local' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
