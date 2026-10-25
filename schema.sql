-- Run this in Supabase SQL editor

-- Accounts
CREATE TABLE IF NOT EXISTS accounts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('demo', 'real')),
  balance    NUMERIC(18,8) NOT NULL DEFAULT 0,
  total_pl   NUMERIC(18,8) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, type)
);

-- Contracts
CREATE TABLE IF NOT EXISTS contracts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id),
  account_id       UUID NOT NULL REFERENCES accounts(id),
  symbol           TEXT NOT NULL CHECK (symbol IN ('V20_1S', 'V50_1S', 'V100_1S')),
  contract_type    TEXT NOT NULL CHECK (contract_type IN ('rise_fall','over_under','match_differ','even_odd')),
  direction        TEXT NOT NULL,
  selected_digit   INT CHECK (selected_digit BETWEEN 0 AND 9),
  stake            NUMERIC(18,8) NOT NULL,
  potential_payout NUMERIC(18,8) NOT NULL,
  entry_price      NUMERIC(18,8) NOT NULL,
  exit_price       NUMERIC(18,8),
  entry_tick       BIGINT NOT NULL,
  duration_ticks   INT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled','cancelled')),
  outcome          TEXT CHECK (outcome IN ('win','loss')),
  settled_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Transactions
CREATE TABLE IF NOT EXISTS transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id),
  type        TEXT NOT NULL CHECK (type IN ('deposit','withdrawal','trade_win','trade_loss','stake')),
  amount_usd  NUMERIC(18,8) NOT NULL,
  amount_kes  NUMERIC(18,2),
  method      TEXT,
  reference   TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed')),
  metadata    JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- KYC Documents
CREATE TABLE IF NOT EXISTS kyc_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id),
  doc_type    TEXT NOT NULL CHECK (doc_type IN ('id_front','id_back','selfie')),
  file_path   TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- KYC Submissions
CREATE TABLE IF NOT EXISTS kyc_submissions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'needs_review')),
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at  TIMESTAMPTZ,
  reviewed_by  UUID REFERENCES auth.users(id),
  notes        TEXT,
  UNIQUE(user_id)
);

-- Withdrawal Requests
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  amount_usd      NUMERIC(18,8) NOT NULL,
  amount_kes      NUMERIC(18,2) NOT NULL,
  phone           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending_review' 
                    CHECK (status IN ('pending_review', 'approved', 'processing', 'completed', 'rejected', 'failed')),
  transaction_id  UUID REFERENCES transactions(id),
  reviewed_at     TIMESTAMPTZ,
  reviewed_by     UUID REFERENCES auth.users(id),
  approved_at     TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- User Roles
CREATE TABLE IF NOT EXISTS user_roles (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  role       TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'support', 'admin')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotency Keys
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key        TEXT NOT NULL,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  response   JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(key, user_id)
);

-- Admin Audit Log
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID NOT NULL REFERENCES auth.users(id),
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   UUID,
  details     JSONB,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Exchange Rates
CREATE TABLE IF NOT EXISTS exchange_rates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_ccy   TEXT NOT NULL,
  to_ccy     TEXT NOT NULL,
  rate       NUMERIC(18,6) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── RLS Policies ──────────────────────────────────────────────────

ALTER TABLE accounts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_documents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_submissions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys   ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log    ENABLE ROW LEVEL SECURITY;

-- User policies (read their own data)
CREATE POLICY "users_own_accounts"      ON accounts      FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "users_own_contracts"     ON contracts     FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "users_own_transactions"  ON transactions  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "users_own_kyc_docs"      ON kyc_documents FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "users_own_kyc_sub"       ON kyc_submissions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "users_own_withdrawals"   ON withdrawal_requests FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "users_own_roles"         ON user_roles FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "users_own_idempotency"   ON idempotency_keys FOR ALL USING (auth.uid() = user_id);

-- ── Postgres Functions ────────────────────────────────────────────

-- Deduct balance (atomic)
CREATE OR REPLACE FUNCTION deduct_balance(p_account_id UUID, p_amount NUMERIC)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE accounts SET balance = balance - p_amount
  WHERE id = p_account_id AND balance >= p_amount;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE';
  END IF;
END;
$$;

-- Increment balance
CREATE OR REPLACE FUNCTION increment_balance(p_account_id UUID, p_amount NUMERIC)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE accounts SET balance = balance + p_amount WHERE id = p_account_id;
END;
$$;

-- Update P/L
CREATE OR REPLACE FUNCTION update_pl(p_account_id UUID, p_delta NUMERIC)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE accounts SET total_pl = total_pl + p_delta WHERE id = p_account_id;
END;
$$;

-- Initial exchange rate
INSERT INTO exchange_rates (from_ccy, to_ccy, rate) 
VALUES ('USD', 'KES', 130) 
ON CONFLICT DO NOTHING;

ALTER TABLE exchange_rates ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';