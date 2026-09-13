// Request/Response schemas for server-side validation
import { t } from './schema-validator';

// ============================================================================
// Feed Schemas
// ============================================================================

export const feedListSchema = t.Object({
  page: t.Number({ optional: true }),
  limit: t.Number({ optional: true }),
  type: t.String({ optional: true }),
});

export const feedCreateSchema = t.Object({
  title: t.String({ minLength: 1 }),
  content: t.String({ minLength: 1 }),
  summary: t.String({ optional: true }),
  alias: t.String({ optional: true }),
  draft: t.Boolean(),
  listed: t.Boolean(),
  createdAt: t.Date({ optional: true }),
  tags: t.Array(t.String()),
});

export const feedUpdateSchema = t.Object({
  title: t.String({ optional: true }),
  alias: t.String({ optional: true }),
  content: t.String({ optional: true }),
  summary: t.String({ optional: true }),
  listed: t.Boolean(),
  draft: t.Boolean({ optional: true }),
  createdAt: t.Date({ optional: true }),
  tags: t.Array(t.String(), { optional: true }),
  top: t.Numeric({ optional: true }),
});

export const feedSetTopSchema = t.Object({
  top: t.Numeric(),
});

// ============================================================================
// Auth Schemas
// ============================================================================

export const loginSchema = t.Object({
  username: t.String({ minLength: 1 }),
  password: t.String({ minLength: 1 }),
});

// ============================================================================
// User Schemas
// ============================================================================

export const updateProfileSchema = t.Object({
  username: t.String({ optional: true }),
  avatar: t.String({ optional: true }),
});

// ============================================================================
// Comment Schemas
// ============================================================================

export const commentCreateSchema = t.Object({
  content: t.String({ minLength: 1 }),
  guestName: t.String({ optional: true }),
  guestEmail: t.String({ optional: true }),
  guestWebsite: t.String({ optional: true }),
});

// ============================================================================
// Friend Schemas
// ============================================================================

export const friendCreateSchema = t.Object({
  name: t.String({ minLength: 1, maxLength: 20 }),
  desc: t.String({ minLength: 1, maxLength: 100 }),
  avatar: t.String({ minLength: 1, maxLength: 100 }),
  url: t.String({ minLength: 1, maxLength: 100 }),
});

// Every field is optional: the handler treats an empty string as "keep the
// stored value", so a friend link can be updated one field at a time.
export const friendUpdateSchema = t.Object({
  name: t.String({ optional: true }),
  desc: t.String({ optional: true }),
  avatar: t.String({ optional: true }),
  url: t.String({ optional: true }),
  accepted: t.Numeric({ optional: true }),
  sort_order: t.Numeric({ optional: true }),
});

// ============================================================================
// Moment Schemas
// ============================================================================

export const momentCreateSchema = t.Object({
  content: t.String({ minLength: 1 }),
});

export const momentUpdateSchema = t.Object({
  content: t.String({ minLength: 1 }),
});

// ============================================================================
// AI Config Schemas
// ============================================================================

export const aiConfigUpdateSchema = t.Object({
  enabled: t.Boolean({ optional: true }),
  provider: t.String({ optional: true }),
  model: t.String({ optional: true }),
  api_key: t.String({ optional: true }),
  api_url: t.String({ optional: true }),
});

// ============================================================================
// WordPress Import Schemas
// ============================================================================

export const wpImportSchema = t.Object({
  data: t.File(),
});

// ============================================================================
// Search Schemas
// ============================================================================

export const searchSchema = t.Object({
  page: t.Number({ optional: true }),
  limit: t.Number({ optional: true }),
});
