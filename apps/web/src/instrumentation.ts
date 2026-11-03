// Runs once when a server instance starts. A hosted deployment without APP_ENV fails here,
// so a misconfigured Vercel environment is visibly broken instead of running as `local`.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertDeploymentEnv } = await import('@s10/core/config');
    assertDeploymentEnv(process.env);
  }
}
