import 'server-only';
import { createSuiteClient, type SuiteClient } from '@s10/core/suite';
import { getCognitoSettings } from './auth/cognito';

let cached: { key: string; client: SuiteClient } | undefined;

/** The Suite API client for this function instance (it holds the 60 s answer cache). */
export async function getSuiteClient(): Promise<SuiteClient> {
  const { suiteUrl, appId } = await getCognitoSettings();
  const key = `${suiteUrl}|${appId}`;
  if (cached?.key !== key) cached = { key, client: createSuiteClient({ suiteUrl, appId }) };
  return cached.client;
}
