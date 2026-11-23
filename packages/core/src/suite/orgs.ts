import type { Database } from '../db/client';
import type { OrgSummary } from '../domain/orgs/service';
import { SuiteUnavailableError, type SuiteClient, type SuiteMe } from './client';
import { accountsToSync, syncSuiteOrganizations, type SyncAccount } from './tenancy';

export type OrgResolution =
  | { state: 'ok'; me: SuiteMe; orgs: OrgSummary[] }
  /** The Suite could not be reached or gave an unusable answer. Nothing was read or written. */
  | { state: 'suite-unavailable' }
  /** The Suite refused this person's token. Nothing was written. */
  | { state: 'suite-refused' };

export interface OrgResolverOptions {
  appId: string;
  /** For tests. */
  sync?: (db: Database, userId: string, accounts: SyncAccount[]) => Promise<OrgSummary[]>;
  now?: () => number;
}

/** The same answer for the same person within this time skips the (idempotent) database sync. */
export const SYNC_REUSE_MS = 5 * 60 * 1000;

/**
 * Who the person is in this app, from the Suite: their accounts (organizations) where the app is
 * on. Fail closed (builder rule 3): when the Suite gives no answer, `sync` is NOT called, so no
 * organization is created, no membership is changed or removed, and no stale membership is read.
 */
export function createOrgResolver(options: OrgResolverOptions) {
  const sync = options.sync ?? syncSuiteOrganizations;
  const now = options.now ?? Date.now;
  const last = new Map<string, { fingerprint: string; at: number; orgs: OrgSummary[] }>();

  return {
    async resolve(args: {
      client: Pick<SuiteClient, 'me'>;
      db: Database;
      userId: string;
      accessToken: string;
      sub: string;
    }): Promise<OrgResolution> {
      let me: SuiteMe | null;
      try {
        me = await args.client.me({ accessToken: args.accessToken, sub: args.sub });
      } catch (err) {
        if (err instanceof SuiteUnavailableError) return { state: 'suite-unavailable' };
        throw err;
      }
      if (!me) return { state: 'suite-refused' };

      const accounts = accountsToSync(me, options.appId);
      const fingerprint = JSON.stringify(accounts);
      const known = last.get(args.userId);
      if (known && known.fingerprint === fingerprint && now() - known.at < SYNC_REUSE_MS) {
        return { state: 'ok', me, orgs: known.orgs };
      }
      const orgs = await sync(args.db, args.userId, accounts);
      last.set(args.userId, { fingerprint, at: now(), orgs });
      return { state: 'ok', me, orgs };
    },
    /** For tests and sign-out. */
    forget: () => last.clear(),
  };
}
