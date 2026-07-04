-- Rollback for 0000 — F0 Auth Substrate
DROP TABLE IF EXISTS service_identity_roles;
DROP TABLE IF EXISTS service_identities;
DROP TABLE IF EXISTS staff_user_roles;
DROP TABLE IF EXISTS staff_users;
-- Types retained if still referenced elsewhere; drop only if unused.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_depend d JOIN pg_type t ON d.refobjid = t.oid WHERE t.typname = 'dsusa_role') THEN
    DROP TYPE IF EXISTS dsusa_role;
  END IF;
END$$;
