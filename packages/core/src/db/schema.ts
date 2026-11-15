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

export const POST_STATUSES = [
  'draft',
  'awaiting_approval',
  'approved',
  'scheduled',
  'publishing',
  'published',
  'failed',
  'needs_reconciliation',
  'canceled',
  'archived',
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];
export const postStatus = appSchema.enum('post_status', POST_STATUSES);

export const orgEntitlements = pgTable('org_entitlements', {
  orgId: uuid('org_id').primaryKey(),
  aiMonthlyBudgetMicros: bigint('ai_monthly_budget_micros', { mode: 'number' }),
  aiDailyCalls: integer('ai_daily_calls'),
  webFetchDaily: integer('web_fetch_daily'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const AI_GENERATION_STATUSES = ['pending', 'succeeded', 'failed', 'invalid_output'] as const;
export type AiGenerationStatus = (typeof AI_GENERATION_STATUSES)[number];

export const aiGenerations = pgTable(
  'ai_generations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    brandId: uuid('brand_id').notNull(),
    task: text('task').notNull(),
    templateId: text('template_id').notNull(),
    templateVersion: integer('template_version').notNull(),
    provider: text('provider').notNull(),
    modelId: text('model_id').notNull(),
    status: text('status').$type<AiGenerationStatus>().notNull().default('pending'),
    reservedMicros: bigint('reserved_micros', { mode: 'number' }).notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    costMicros: bigint('cost_micros', { mode: 'number' }).notNull().default(0),
    latencyMs: integer('latency_ms'),
    errorCode: text('error_code'),
    sourceUrl: text('source_url'),
    sourceExcerpt: text('source_excerpt'),
    output: jsonb('output').$type<unknown>(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [unique().on(t.orgId, t.id)],
);

export const usageEvents = pgTable('usage_events', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  orgId: uuid('org_id').notNull(),
  kind: text('kind').$type<'ai_tokens' | 'web_fetch'>().notNull(),
  quantity: bigint('quantity', { mode: 'number' }).notNull(),
  costMicros: bigint('cost_micros', { mode: 'number' }).notNull().default(0),
  refId: uuid('ref_id'),
  createdBy: uuid('created_by'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});

export const contentItems = pgTable(
  'content_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    brandId: uuid('brand_id').notNull(),
    kind: text('kind').$type<'post' | 'article' | 'campaign'>().notNull().default('post'),
    title: text('title'),
    brief: text('brief'),
    sourceItemId: uuid('source_item_id'),
    createdBy: uuid('created_by'),
    ...timestamps,
  },
  (t) => [unique().on(t.orgId, t.id)],
);

export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    brandId: uuid('brand_id').notNull(),
    contentItemId: uuid('content_item_id'),
    targetId: uuid('target_id'),
    status: postStatus('status').notNull().default('draft'),
    body: text('body').notNull().default(''),
    linkUrl: text('link_url'),
    contentHash: text('content_hash').generatedAlwaysAs(
      sql`md5(lower(regexp_replace(body, '\\s+', ' ', 'g')) || coalesce(link_url, ''))`,
    ),
    aiGenerationId: uuid('ai_generation_id'),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by'),
    ...timestamps,
  },
  (t) => [unique().on(t.orgId, t.id)],
);

export const postRevisions = pgTable(
  'post_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    postId: uuid('post_id').notNull(),
    version: integer('version').notNull(),
    body: text('body').notNull(),
    linkUrl: text('link_url'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.orgId, t.id), unique().on(t.postId, t.version)],
);

export const schema = {
  users,
  userIdentities,
  organizations,
  organizationMembers,
  brands,
  brandVoiceProfiles,
  auditLogs,
  systemFlags,
  orgEntitlements,
  aiGenerations,
  usageEvents,
  contentItems,
  posts,
  postRevisions,
};
export type Schema = typeof schema;
