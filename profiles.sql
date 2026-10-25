-- Migration: profiles table (fixes 500s caused by querying auth.users
-- directly through the API) + backfill for users created before the
-- on_auth_user_created trigger existed + corrected total_users count.
--
-- Run this in the Supabase SQL editor AFTER schema.sql, trigger.sql, roles.sql.

-- ── 1. Profiles table ────────────────────────────────────────────────
-- PostgREST never exposes the `auth` schema, regardless of which API key
-- is used. Every admin.js query that referenced `auth.users` directly
-- (getUsers, getPendingKyc, getPendingWithdrawals, getAuditLog) was
-- throwing at the database layer and surfacing as a 500. This table
-- mirrors just the fields the admin dashboard needs, in `public`, kept
-- in sync by the signup trigger.

CREATE TABLE IF NOT EXISTS profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT,
  display_name TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);

-- ── 2. Update the signup trigger to also populate profiles ──────────
-- Same function as trigger.sql, with the profiles insert added. Safe to
-- re-run — CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data ->> 'display_name'
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.accounts (user_id, type, balance)
  VALUES
    (NEW.id, 'demo', 10000),
    (NEW.id, 'real', 0)
  ON CONFLICT (user_id, type) DO NOTHING;

  INSERT INTO public.kyc_submissions (user_id, status)
  VALUES (NEW.id, 'pending')
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Trigger itself is unchanged, but re-declared here so this file is
-- runnable standalone.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 3. Backfill for every user created before this migration ────────
-- This SQL editor session runs with full access to auth.users, so this
-- works even though the app's API never can. Safe to re-run.

INSERT INTO public.profiles (id, email, display_name)
SELECT id, email, raw_user_meta_data ->> 'display_name'
FROM auth.users
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.accounts (user_id, type, balance)
SELECT id, 'demo', 10000 FROM auth.users
ON CONFLICT (user_id, type) DO NOTHING;

INSERT INTO public.accounts (user_id, type, balance)
SELECT id, 'real', 0 FROM auth.users
ON CONFLICT (user_id, type) DO NOTHING;

INSERT INTO public.kyc_submissions (user_id, status)
SELECT id, 'pending' FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'user' FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- ── 4. Fix total_users in get_platform_stats() ───────────────────────
-- Was counting `accounts WHERE type = 'real'`, which is only accurate
-- once every user has an account row — true now that the backfill above
-- has run, but counting profiles directly is more explicit and doesn't
-- silently drift if account rows are ever deleted independently.

CREATE OR REPLACE FUNCTION get_platform_stats()
RETURNS TABLE (
  total_balance_real   NUMERIC,
  total_balance_demo   NUMERIC,
  total_deposited       NUMERIC,
  total_withdrawn       NUMERIC,
  total_influencer_withdrawn NUMERIC,
  total_users           BIGINT
) LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE((SELECT SUM(balance) FROM accounts WHERE type = 'real'), 0),
    COALESCE((SELECT SUM(balance) FROM accounts WHERE type = 'demo'), 0),
    COALESCE((SELECT SUM(amount_usd) FROM transactions WHERE type = 'deposit' AND status = 'completed'), 0),
    COALESCE((SELECT SUM(amount_usd) FROM transactions WHERE type = 'withdrawal' AND status = 'completed'), 0),
    COALESCE((SELECT SUM(amount_usd) FROM influencer_withdrawals), 0),
    (SELECT COUNT(*) FROM profiles);
$$;