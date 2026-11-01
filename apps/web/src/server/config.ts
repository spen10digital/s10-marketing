import 'server-only';
import { SSMClient } from '@aws-sdk/client-ssm';
import { loadConfig, publicConfig, type AppConfig } from '@s10/core/config';
import { awsCredentials, AWS_REGION } from './aws';

let cached: Promise<AppConfig> | undefined;

/** Loaded once per function instance; reset on failure so the next request retries. */
export function getConfig(): Promise<AppConfig> {
  cached ??= loadConfig({ ssm: new SSMClient({ region: AWS_REGION, credentials: awsCredentials() }) }).catch(
    (err: unknown) => {
      cached = undefined;
      throw err;
    },
  );
  return cached;
}

export async function getPublicConfig() {
  return publicConfig(await getConfig());
}
