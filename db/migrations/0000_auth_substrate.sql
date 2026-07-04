-- ============================================================================
-- DSUSA Migration 0000 — F0 Auth Substrate
-- staff_users / RBAC roles / service identities.
-- This is the identity FOUNDATION (not the Authorization Service / PMS-3).
-- Forward-only; reversible via 0000_down.sql.
-- ============================================================================

-- Roles enumerated as a domain (matches @dsusa/auth-kit ROLES).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dsusa_role') THEN
    CREATE TYPE dsusa_role AS ENUM (
      'platform_admin',
      'identity_steward',
      'audit_reader',
      'governance_admin',
      'agent_admin',
      'reviewer',
      'service'
    );
  END IF;
END$$;

-- actor_type domain (matches Audit Service PMS-1 §5 and @dsusa/types ACTOR_TYPES).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dsusa_actor_type') THEN
    CREATE TYPE dsusa_actor_type AS ENUM ('agent', 'service', 'human', 'ai', 'system');
  END IF;
END$$;

-- Human staff users.
CREATE TABLE IF NOT EXISTS staff_users (
  user_id      text PRIMARY KEY,
  display_name text NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff_user_roles (
  user_id text NOT NULL REFERENCES staff_users(user_id),
  role    dsusa_role NOT NULL,
  PRIMARY KEY (user_id, role)
);

-- Service identities (mutual service auth). Agents authenticate as service identities.
CREATE TABLE IF NOT EXISTS service_identities (
  service_id   text PRIMARY KEY,
  display_name text NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_identity_roles (
  service_id text NOT NULL REFERENCES service_identities(service_id),
  role       dsusa_role NOT NULL,
  PRIMARY KEY (service_id, role)
);

-- NOTE: No business-authority tables here. Standing/eligibility live in their owning
-- Domain Agents / Registries; the Authorization Service (PMS-3) composes them, never stores them.
