import { describe, expect, it } from 'vitest';
import { brandInput } from './brands/service';
import { brandVoiceInput } from './brands/voice';
import { createOrganizationInput } from './orgs/service';
import { assertCan, can } from './permissions';
import { isValidTimeZone, SLUG_PATTERN, slugify } from './slug';

describe('permissions', () => {
  it('follows the owner > admin > editor > viewer order', () => {
    expect(can('owner', 'brand.create')).toBe(true);
    expect(can('admin', 'brand.create')).toBe(true);
    expect(can('editor', 'brand.create')).toBe(false);
    expect(can('editor', 'brand.voice.update')).toBe(true);
    expect(can('viewer', 'brand.voice.update')).toBe(false);
    expect(can('viewer', 'org.read')).toBe(true);
    expect(can(null, 'org.read')).toBe(false);
    expect(() => assertCan('viewer', 'brand.update')).toThrow(/permission/);
  });
});

describe('slugify', () => {
  it.each([
    ['Loot Goblin Labs!', 'loot-goblin-labs'],
    ['S10/Mail', 's10-mail'],
    ['  Café  Crème ', 'cafe-creme'],
    ['!!!', 'untitled'],
  ])('%s → %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
    expect(SLUG_PATTERN.test(slugify(input))).toBe(true);
  });

  it('caps length without a trailing hyphen', () => {
    const slug = slugify(`${'a'.repeat(47)} b`);
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('validates IANA time zones', () => {
    expect(isValidTimeZone('America/Los_Angeles')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('input schemas', () => {
  it('validates organizations', () => {
    expect(createOrganizationInput.safeParse({ name: ' S10 ', timezone: 'Europe/London' }).data).toEqual({
      name: 'S10',
      timezone: 'Europe/London',
    });
    expect(createOrganizationInput.safeParse({ name: '', timezone: 'UTC' }).success).toBe(false);
    expect(createOrganizationInput.safeParse({ name: 'x', timezone: 'Nope/Nope' }).success).toBe(false);
  });

  it('normalises empty brand fields and rejects bad slugs and URLs', () => {
    expect(
      brandInput.parse({ name: 'SPEN10', slug: '', description: '', websiteUrl: '', timezone: '' }),
    ).toMatchObject({ name: 'SPEN10', slug: undefined, description: null, websiteUrl: null, timezone: null });
    expect(brandInput.safeParse({ name: 'x', slug: 'Bad Slug' }).success).toBe(false);
    expect(brandInput.safeParse({ name: 'x', websiteUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(brandInput.safeParse({ name: 'x', websiteUrl: 'https://spen10.com' }).success).toBe(true);
  });

  it('limits voice lists and drops blank entries', () => {
    const voice = brandVoiceInput.parse({
      audience: 'a',
      tone: 't',
      guidelines: 'g',
      doList: ['one', ' ', 'two'],
      dontList: [],
      examplePosts: [],
      ctaDefaults: [],
    });
    expect(voice.doList).toEqual(['one', 'two']);
    expect(
      brandVoiceInput.safeParse({ ...voice, doList: Array.from({ length: 21 }, () => 'x') }).success,
    ).toBe(false);
  });
});
