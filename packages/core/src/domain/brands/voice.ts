import { and, desc, eq } from 'drizzle-orm';
import type { DbTx } from '../../db/client';
import { brandVoiceProfiles, users } from '../../db/schema';
import { AppError } from '../../errors/app-error';
import { assertCan } from '../permissions';
import { conflictOr, type OrgActor } from './service';

export type BrandVoiceProfile = typeof brandVoiceProfiles.$inferSelect;

export { brandVoiceInput, type BrandVoiceInput } from './voice-input';
import { brandVoiceInput, type BrandVoiceInput } from './voice-input';

/** The current voice profile is the highest version; null until the first save. */
export async function getCurrentVoice(tx: DbTx, orgId: string, brandId: string) {
  const [row] = await tx
    .select()
    .from(brandVoiceProfiles)
    .where(and(eq(brandVoiceProfiles.orgId, orgId), eq(brandVoiceProfiles.brandId, brandId)))
    .orderBy(desc(brandVoiceProfiles.version))
    .limit(1);
  return row ?? null;
}

export async function listVoiceVersions(tx: DbTx, orgId: string, brandId: string, limit = 20) {
  return tx
    .select({
      id: brandVoiceProfiles.id,
      version: brandVoiceProfiles.version,
      createdAt: brandVoiceProfiles.createdAt,
      createdByEmail: users.email,
    })
    .from(brandVoiceProfiles)
    .leftJoin(users, eq(users.id, brandVoiceProfiles.createdBy))
    .where(and(eq(brandVoiceProfiles.orgId, orgId), eq(brandVoiceProfiles.brandId, brandId)))
    .orderBy(desc(brandVoiceProfiles.version))
    .limit(limit);
}

/**
 * Saves a new version (versions are immutable). `expectedVersion` is the version the editor
 * started from (0 when there was none), so two people editing at once can't silently overwrite
 * each other.
 */
export async function saveVoice(
  tx: DbTx,
  actor: OrgActor,
  brandId: string,
  input: BrandVoiceInput,
  expectedVersion: number,
): Promise<BrandVoiceProfile> {
  assertCan(actor.role, 'brand.voice.update');
  const data = brandVoiceInput.parse(input);
  const current = await getCurrentVoice(tx, actor.orgId, brandId);
  if ((current?.version ?? 0) !== expectedVersion) {
    throw new AppError('CONFLICT', 'Someone else saved this voice profile. Reload to see their changes.');
  }
  try {
    const [row] = await tx
      .insert(brandVoiceProfiles)
      .values({ ...data, orgId: actor.orgId, brandId, version: expectedVersion + 1, createdBy: actor.userId })
      .returning();
    if (!row) throw new AppError('INTERNAL', 'The voice profile could not be saved.');
    return row;
  } catch (err) {
    throw conflictOr(err, 'Someone else saved this voice profile. Reload to see their changes.');
  }
}
