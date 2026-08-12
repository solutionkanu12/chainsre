/**
 * Row types for the Phase 1 auth/organization foundation. These mirror the SQL
 * migration in `supabase/migrations` and give the API and, later, typed
 * Supabase clients a single source of truth for the foundation tables.
 *
 * Application data tables (enrollments, intents, executions, incidents, …) are
 * added in Phase 4 and will extend these types then.
 */

export type MembershipRole = 'owner' | 'admin' | 'member';

export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: MembershipRole;
  created_at: string;
}

/** Names of the foundation tables, useful for typed query builders. */
export const FOUNDATION_TABLES = ['profiles', 'organizations', 'organization_members'] as const;
export type FoundationTable = (typeof FOUNDATION_TABLES)[number];
