import { SuiteUnavailableError, type SuiteBusinessProfile } from './client';

export interface CardBrand {
  id: string;
  name: string;
  description: string | null;
  websiteUrl: string | null;
  suiteBusinessId: string | null;
}

export interface BrandCardSummary {
  /** The line shown under the brand name. */
  summary: string | null;
  /** True when the Suite could not be asked, so the card is showing only what Marketing holds. */
  suiteUnavailable: boolean;
}

/**
 * What a brand card says under the name: the Suite business profile first (description, else
 * website), then what Marketing holds itself. When the Suite cannot be reached or gives no answer
 * the card uses the local values and flags it; nothing is written and nothing throws (fail
 * closed for data, graceful for the page).
 */
export async function brandCardSummaries(
  brands: CardBrand[],
  loadProfile: (businessId: string) => Promise<SuiteBusinessProfile | null>,
): Promise<Map<string, BrandCardSummary>> {
  const entries = await Promise.all(
    brands.map(async (b): Promise<[string, BrandCardSummary]> => {
      let profile: SuiteBusinessProfile | null = null;
      let suiteUnavailable = false;
      if (b.suiteBusinessId) {
        try {
          profile = await loadProfile(b.suiteBusinessId);
        } catch (err) {
          if (!(err instanceof SuiteUnavailableError)) throw err;
          suiteUnavailable = true;
        }
      }
      const summary =
        profile?.description?.trim() ||
        b.description ||
        profile?.website ||
        b.websiteUrl ||
        profile?.contact_email ||
        null;
      return [b.id, { summary, suiteUnavailable }];
    }),
  );
  return new Map(entries);
}
