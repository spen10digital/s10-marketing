import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgSchema,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Typed mirror of db/migrations (the SQL files are the source of truth; 05 §4). RLS, grants and
 * triggers live only in SQL.
 */
export const appSchema = pgSchema('app');
export const ORG_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
export const orgRole = appSchema.enum('org_role', ORG_ROLES);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  ...timestamps,
});

export const userIdentities = pgTable(
  'user_identities',
  {
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.issuer, t.subject] })],
);

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  timezone: text('timezone').notNull(),
  createdBy: uuid('created_by'),
  ...timestamps,
});

export const organizationMembers = pgTable(
  'organization_members',
  {
    orgId: uuid('org_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: orgRole('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

export const brands = pgTable(
  'brands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    websiteUrl: text('website_url'),
    timezone: text('timezone'),
    settings: jsonb('settings')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    ...timestamps,
  },
  (t) => [unique().on(t.orgId, t.id), unique().on(t.orgId, t.slug)],
);

export const brandVoiceProfiles = pgTable(
  'brand_voice_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    brandId: uuid('brand_id').notNull(),
    version: integer('version').notNull(),
    audience: text('audience').notNull(),
    tone: text('tone').notNull(),
    guidelines: text('guidelines').notNull(),
    doList: jsonb('do_list').$type<string[]>().notNull(),
    dontList: jsonb('dont_list').$type<string[]>().notNull(),
    examplePosts: jsonb('example_posts').$type<string[]>().notNull(),
    ctaDefaults: jsonb('cta_defaults').$type<string[]>().notNull(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.orgId, t.id), unique().on(t.brandId, t.version)],
);

export const auditLogs = pgTable('audit_logs', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  orgId: uuid('org_id'),
  actorUserId: uuid('actor_user_id'),
  actorType: text('actor_type').notNull(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const systemFlags = pgTable('system_flags', {
  key: text('key').primaryKey(),
  enabled: boolean('enabled').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const schema = {
  users,
  userIdentities,
  organizations,
  organizationMembers,
  brands,
  brandVoiceProfiles,
  auditLogs,
  systemFlags,
};
export type Schema = typeof schema;
