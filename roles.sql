-- Migration: tech/influencer roles + influencer mock-withdrawal flow + admin stats
-- Run this in the Supabase SQL editor AFTER schema.sql and trigger.sql

-- ── 1. Expand allowed roles ─────────────────────────────────────────
-- Existing roles: user, support, admin. Adding: tech, influencer.

ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('user', 'support', 'admin', 'tech', 'influencer'));

-- ── 2. Influencer withdrawals (mock / off-platform simulation) ─────
-- When an influencer withdraws, money is deducted from their REAL account
-- immediately (same "deduct now, resolve later" pattern as
-- withdrawal_requests) and a row lands here as 'pending'. A later,
-- separate admin/tech interface will flip it to 'sent' (or 'failed',
-- which refunds the balance) to simulate the payout actually leaving
-- the platform. No real money movement happens against this table.

CREATE TABLE IF NOT EXISTS influencer_withdrawals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id    UUID NOT NULL REFERENCES accounts(id),
  amount_usd    NUMERIC(18,8) NOT NULL CHECK (amount_usd > 0),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  simulated_at  TIMESTAMPTZ,
  simulated_by  UUID REFERENCES auth.users(id),
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE influencer_withdrawals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_influencer_withdrawals" ON influencer_withdrawals
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_influencer_withdrawals_user   ON influencer_withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_influencer_withdrawals_status ON influencer_withdrawals(status);

-- ── 3. Admin dashboard stats (single round trip) ────────────────────
-- Total real/demo balance currently sitting in the DB, total deposited,
-- total withdrawn (real withdrawals only — influencer mock withdrawals
-- are excluded since no money has actually left anything).

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
    (SELECT COUNT(*) FROM accounts WHERE type = 'real');
$$;