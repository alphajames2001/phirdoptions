-- ============================================================================
--  G-Wave B2C — complete database schema
--  Single-file rebuild script.
--
--  Replaces the previous split files:
--    schema.sql + trigger.sql + roles.sql + profiles.sql + trade_rpcs.sql
--
--  HOW TO USE
--    Supabase Dashboard → SQL Editor → New query → paste this whole file → Run.
--    It runs as one transaction: if any statement fails, nothing is applied.
--
--  The script is idempotent. It is safe to run against:
--    • a brand new Supabase project (full build), and
--    • an existing project (re-applies changes, backfills anything missing,
--      and never duplicates rows).
--
--  IT REQUIRES Supabase (it references the auth schema and the
--  anon / authenticated / service_role roles). It will not run on a
--  plain Postgres server.
--
--  AFTER RUNNING THIS, the application still needs its environment:
--    SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
--    SUPABASE_JWT_SECRET, FRONTEND_URL, ADMIN_EMAILS, REDIS_URL,
--    plus the M-Pesa / PalPlus credentials.
-- ============================================================================


-- ============================================================================
--  1. TABLES
-- ============================================================================

-- ── Accounts ───────────────────────────────────────────────────────────────
-- One row per user per account type. 'demo' holds play money (10000 at
-- signup), 'real' holds actual deposited money. balance is the single
-- source of truth for money — Postgres stays authoritative even when the
-- Redis trade cache is in front of it.
CREATE TABLE IF NOT EXISTS accounts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('demo', 'real')),
  balance    NUMERIC(18,8) NOT NULL DEFAULT 0,
  total_pl   NUMERIC(18,8) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, type)
);

-- ── Contracts ─────────────────────────────────────────────────────────────
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

-- ── Transactions ──────────────────────────────────────────────────────────
-- Append-only ledger. 'stake', 'trade_win' and 'trade_loss' are written
-- by the place_trade / settle_contracts functions, never by the API.
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

-- ── KYC Documents ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kyc_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id),
  doc_type    TEXT NOT NULL CHECK (doc_type IN ('id_front','id_back','selfie')),
  file_path   TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── KYC Submissions ───────────────────────────────────────────────────────
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

-- ── Withdrawal Requests ───────────────────────────────────────────────────
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

-- ── User Roles ────────────────────────────────────────────────────────────
-- The role check constraint is widened below to include 'tech' and
-- 'influencer'.
CREATE TABLE IF NOT EXISTS user_roles (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  role       TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'support', 'admin')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Idempotency Keys ──────────────────────────────────────────────────────
-- Guards the money-moving endpoints against duplicate requests. The
-- stored key is scoped by method + path + client key (see middleware.js),
-- so a client reusing one raw key across two endpoints cannot replay
-- the wrong response.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key        TEXT NOT NULL,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  response   JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(key, user_id)
);

-- ── Admin Audit Log ───────────────────────────────────────────────────────
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

-- ── Exchange Rates ────────────────────────────────────────────────────────
-- Append-only history: the rate updater inserts a new row each time and
-- readers take the most recent. 'source' records where the rate came
-- from.
CREATE TABLE IF NOT EXISTS exchange_rates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_ccy   TEXT NOT NULL,
  to_ccy     TEXT NOT NULL,
  rate       NUMERIC(18,6) NOT NULL,
  source     TEXT DEFAULT 'manual',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Added after the original table shipped; kept for existing databases.
ALTER TABLE exchange_rates ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';

-- ── Influencer Withdrawals ────────────────────────────────────────────────
-- Off-platform simulation. The money is deducted from the influencer's
-- real account immediately (deduct now, resolve later — the same pattern
-- as withdrawal_requests) and a row lands here as 'pending'. A later
-- admin/tech action flips it to 'sent', or to 'failed' which refunds
-- the balance. No real money moves against this table.
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

-- ── Profiles ──────────────────────────────────────────────────────────────
-- PostgREST never exposes the `auth` schema, regardless of which API key
-- is used. Every admin query that referenced auth.users directly was
-- throwing at the database layer and surfacing as a 500. This table
-- mirrors just the fields the admin dashboard needs, in `public`, kept
-- in sync by the signup trigger.
CREATE TABLE IF NOT EXISTS profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT,
  display_name TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================================
--  2. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_profiles_email                ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_influencer_withdrawals_user   ON influencer_withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_influencer_withdrawals_status ON influencer_withdrawals(status);

-- The hot paths the API hits on every request.
CREATE INDEX IF NOT EXISTS idx_accounts_user                  ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_contracts_account             ON contracts(account_id);
CREATE INDEX IF NOT EXISTS idx_contracts_user_status         ON contracts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_contracts_created_at          ON contracts(created_at DESC);
-- Open contracts only. Without this the engine's open-contract queries
-- sequentially scan the whole (ever-growing) contracts table. The index stays
-- tiny because settled rows leave it.
CREATE INDEX IF NOT EXISTS idx_contracts_open_symbol         ON contracts(symbol, entry_tick) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_transactions_user_created     ON transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_reference        ON transactions(reference);
CREATE INDEX IF NOT EXISTS idx_kyc_documents_user            ON kyc_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user      ON withdrawal_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status    ON withdrawal_requests(status);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created       ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_pair           ON exchange_rates(from_ccy, to_ccy, updated_at DESC);


-- ============================================================================
--  3. ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE accounts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_documents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_submissions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawal_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys      ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_rates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE influencer_withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles              ENABLE ROW LEVEL SECURITY;

-- Dropped before recreation because CREATE POLICY has no IF NOT EXISTS.
-- Re-running the script therefore updates policies instead of erroring.

-- Users can read and write their own rows.
DROP POLICY IF EXISTS "users_own_accounts"      ON accounts;
CREATE POLICY "users_own_accounts"      ON accounts      FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_own_contracts"     ON contracts;
CREATE POLICY "users_own_contracts"     ON contracts     FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_own_transactions"  ON transactions;
CREATE POLICY "users_own_transactions"  ON transactions  FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_own_kyc_docs"      ON kyc_documents;
CREATE POLICY "users_own_kyc_docs"      ON kyc_documents FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_own_kyc_sub"       ON kyc_submissions;
CREATE POLICY "users_own_kyc_sub"       ON kyc_submissions FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_own_withdrawals"   ON withdrawal_requests;
CREATE POLICY "users_own_withdrawals"   ON withdrawal_requests FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_own_roles"         ON user_roles;
CREATE POLICY "users_own_roles"         ON user_roles FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_own_idempotency"   ON idempotency_keys;
CREATE POLICY "users_own_idempotency"   ON idempotency_keys FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_own_influencer_withdrawals" ON influencer_withdrawals;
CREATE POLICY "users_own_influencer_withdrawals" ON influencer_withdrawals
  FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_own_profile"        ON profiles;
CREATE POLICY "users_own_profile"        ON profiles FOR SELECT USING (auth.uid() = id);


-- ============================================================================
--  4. POSTGRES FUNCTIONS
-- ============================================================================

-- ── Balance primitives ────────────────────────────────────────────────────

-- Deduct balance (atomic). Raises when the balance is short, which the
-- API maps to a 400.
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

-- Increment balance.
CREATE OR REPLACE FUNCTION increment_balance(p_account_id UUID, p_amount NUMERIC)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE accounts SET balance = balance + p_amount WHERE id = p_account_id;
END;
$$;

-- Update cumulative P/L.
CREATE OR REPLACE FUNCTION update_pl(p_account_id UUID, p_delta NUMERIC)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE accounts SET total_pl = total_pl + p_delta WHERE id = p_account_id;
END;
$$;

-- ── Admin dashboard stats ─────────────────────────────────────────────────
-- One round trip for the whole dashboard. Counts users from profiles
-- rather than from accounts, so the number does not silently drift if an
-- account row is ever removed.
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

-- ── place_trade ───────────────────────────────────────────────────────────
-- Atomically: check + deduct the stake, record the stake transaction,
-- and create the open contract.
--
-- The trade path used to spend three sequential HTTP round trips to
-- PostgREST per trade (deduct balance → insert stake transaction →
-- insert contract), and four more per settlement. Each one is a network
-- hop from the API to the database. Folding them into a single function
-- call collapses that into one hop.
--
-- It also closes a real bug: the deduction and the contract insert were
-- separate calls, so a failed insert left the stake deducted with no
-- contract and no rollback. place_trade() does both inside one
-- transaction, so that can no longer happen.
--
-- The payout multiplier itself is NOT recomputed here. market.js is the
-- single source of truth for PAYOUT_MULTIPLIERS (including the over/under
-- edge case), so the calculated payout is passed in.
--
-- Raises 'INSUFFICIENT_BALANCE' when the account cannot cover the stake
-- — the caller maps that to a 400.
CREATE OR REPLACE FUNCTION place_trade(
  p_user_id          UUID,
  p_account_id       UUID,
  p_symbol           TEXT,
  p_contract_type    TEXT,
  p_direction        TEXT,
  p_selected_digit   INT,
  p_stake            NUMERIC,
  p_potential_payout NUMERIC,
  p_entry_price      NUMERIC,
  p_entry_tick       BIGINT,
  p_duration_ticks   INT
)
RETURNS SETOF contracts
LANGUAGE plpgsql
AS $$
DECLARE
  v_contract contracts;
BEGIN
  -- Atomic check-and-decrement. Raises when balance < stake.
  PERFORM deduct_balance(p_account_id, p_stake);

  INSERT INTO transactions (user_id, type, amount_usd, status)
  VALUES (p_user_id, 'stake', p_stake, 'completed');

  INSERT INTO contracts (
    user_id, account_id, symbol, contract_type, direction, selected_digit,
    stake, potential_payout, entry_price, entry_tick, duration_ticks, status
  ) VALUES (
    p_user_id, p_account_id, p_symbol, p_contract_type, p_direction,
    p_selected_digit, p_stake, p_potential_payout, p_entry_price,
    p_entry_tick, p_duration_ticks, 'open'
  )
  RETURNING * INTO v_contract;

  RETURN NEXT v_contract;
END;
$$;

-- ── settle_contracts ─────────────────────────────────────────────────────
-- Settles a batch of contracts in one call. The market engine's expiry
-- loop used to spend four round trips per contract (conditional update,
-- credit balance, insert transaction, update P/L); this does the whole
-- batch in a single round trip.
--
-- p_items is a JSON array of:
--   { "contract_id": uuid,
--     "exit_price":  numeric,
--     "outcome":     "win" | "loss",
--     "settled_at":  timestamptz }
--
-- The per-item claim is atomic: the UPDATE only matches a row that is
-- STILL 'open'. If another path settled the same contract first (the
-- client-initiated POST /trade/settle racing the engine's own tick
-- loop), it matches nothing, no balance is touched, and the row is
-- reported back with already_settled = true. That is what stops the
-- same win being paid out twice.
--
-- Everything for one batch runs inside a single transaction, so a
-- failure rolls the whole batch back and it can safely be retried.
-- The return type changed (exit_price was added) after this function
-- already existed in some databases, and Postgres refuses to replace a
-- function whose return type differs. Drop it first so the script can be
-- re-run safely.
DROP FUNCTION IF EXISTS settle_contracts(JSONB);

CREATE OR REPLACE FUNCTION settle_contracts(p_items JSONB)
RETURNS TABLE (
  contract_id     UUID,
  user_id         UUID,
  outcome         TEXT,
  payout          NUMERIC,
  pl              NUMERIC,
  exit_price      NUMERIC,
  account_id      UUID,
  account_type    TEXT,
  new_balance     NUMERIC,
  already_settled BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_item             RECORD;
  v_claimed_user     UUID;
  v_claimed_account  UUID;
  v_claimed_stake    NUMERIC;
  v_claimed_payout   NUMERIC;
  v_claimed_outcome  TEXT;
  v_claimed_type     TEXT;
  v_claimed_balance  NUMERIC;
  v_claimed_exit     NUMERIC;
  v_payout           NUMERIC;
  v_pl               NUMERIC;
BEGIN
  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(p_items) AS x(
      contract_id UUID,
      exit_price  NUMERIC,
      outcome     TEXT,
      settled_at  TIMESTAMPTZ
    )
  LOOP
    -- Atomic claim. Aliasing the table keeps `outcome` (also an output
    -- parameter of this function) resolving to the column, not the
    -- variable.
    UPDATE contracts AS c
       SET exit_price = v_item.exit_price,
           outcome     = v_item.outcome,
           status      = 'settled',
           settled_at  = v_item.settled_at
     WHERE c.id = v_item.contract_id
       AND c.status = 'open'
    RETURNING c.user_id, c.account_id, c.stake, c.potential_payout, c.outcome
      INTO v_claimed_user, v_claimed_account, v_claimed_stake,
           v_claimed_payout, v_claimed_outcome;

    IF FOUND THEN
      v_payout := CASE WHEN v_claimed_outcome = 'win' THEN v_claimed_payout ELSE 0 END;
      v_pl     := v_payout - v_claimed_stake;

      IF v_payout > 0 THEN
        PERFORM increment_balance(v_claimed_account, v_payout);
      END IF;

      PERFORM update_pl(v_claimed_account, v_pl);

      INSERT INTO transactions (user_id, type, amount_usd, status)
      VALUES (
        v_claimed_user,
        CASE WHEN v_claimed_outcome = 'win' THEN 'trade_win' ELSE 'trade_loss' END,
        CASE WHEN v_claimed_outcome = 'win' THEN v_payout ELSE v_claimed_stake END,
        'completed'
      );

      SELECT a.type, a.balance INTO v_claimed_type, v_claimed_balance
        FROM accounts AS a WHERE a.id = v_claimed_account;

      contract_id     := v_item.contract_id;
      user_id         := v_claimed_user;
      outcome         := v_claimed_outcome;
      payout          := v_payout;
      pl              := v_pl;
      exit_price      := v_item.exit_price;
      account_id      := v_claimed_account;
      account_type    := v_claimed_type;
      new_balance     := v_claimed_balance;
      already_settled := false;
      RETURN NEXT;

    ELSE
      -- Already settled (or unknown contract). Report the stored state
      -- without touching any balance.
      SELECT c.outcome, c.stake, c.potential_payout, c.account_id, c.user_id,
             c.exit_price, a.type, a.balance
        INTO v_claimed_outcome, v_claimed_stake, v_claimed_payout,
             v_claimed_account, v_claimed_user, v_claimed_exit,
             v_claimed_type, v_claimed_balance
        FROM contracts AS c
        JOIN accounts AS a ON a.id = c.account_id
       WHERE c.id = v_item.contract_id;

      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      v_payout := CASE WHEN v_claimed_outcome = 'win' THEN v_claimed_payout ELSE 0 END;

      contract_id     := v_item.contract_id;
      user_id         := v_claimed_user;
      outcome         := v_claimed_outcome;
      payout          := v_payout;
      pl              := v_payout - v_claimed_stake;
      exit_price      := v_claimed_exit;
      account_id      := v_claimed_account;
      account_type    := v_claimed_type;
      new_balance     := v_claimed_balance;
      already_settled := true;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

-- ── Function permissions ─────────────────────────────────────────────────
-- Postgres grants EXECUTE to PUBLIC on every new function, which would
-- expose these through PostgREST to anyone holding the publishable anon
-- key. settle_contracts() in particular would let a caller settle their
-- own contracts and credit their own balance.
--
-- The API only ever calls these through the service-role client, so the
-- grant is narrowed to service_role. Re-running this block is safe.
REVOKE ALL ON FUNCTION public.deduct_balance(UUID, NUMERIC)        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_balance(UUID, NUMERIC)     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_pl(UUID, NUMERIC)             FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_platform_stats()                 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.place_trade(UUID, UUID, TEXT, TEXT, TEXT, INT, NUMERIC, NUMERIC, NUMERIC, BIGINT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_contracts(JSONB)              FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.deduct_balance(UUID, NUMERIC)        TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_balance(UUID, NUMERIC)     TO service_role;
GRANT EXECUTE ON FUNCTION public.update_pl(UUID, NUMERIC)             TO service_role;
GRANT EXECUTE ON FUNCTION public.get_platform_stats()                 TO service_role;
GRANT EXECUTE ON FUNCTION public.place_trade(UUID, UUID, TEXT, TEXT, TEXT, INT, NUMERIC, NUMERIC, NUMERIC, BIGINT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_contracts(JSONB)              TO service_role;


-- ============================================================================
--  5. SIGNUP TRIGGER
-- ============================================================================
-- Creates the profiles row, both accounts, the KYC submission and the
-- default role for every new auth.users row. This is what makes signup
-- work without the API having to be involved at all.

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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ============================================================================
--  6. ROLE CONSTRAINT
-- ============================================================================
-- 'tech' and 'influencer' were added after the original table shipped.
-- The constraint is dropped first so this block is re-runnable.

ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('user', 'support', 'admin', 'tech', 'influencer'));


-- ============================================================================
--  7. BACKFILL
-- ============================================================================
-- This SQL editor session runs with full access to auth.users, so this
-- works even though the app's API never can. Safe to re-run: every insert
-- is ON CONFLICT DO NOTHING. It repairs databases that were created
-- before the trigger existed, or where a row was deleted by hand.

INSERT INTO public.profiles (id, email, display_name)
SELECT id, email, raw_user_meta_data ->> 'display_name' FROM auth.users
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


-- ============================================================================
--  8. SEED DATA
-- ============================================================================
-- The USD/KES rate is only seeded when the table has no rate for the
-- pair at all. The table is append-only history (the rate updater
-- inserts a new row each time), so this must not overwrite a live rate
-- and must not add a duplicate row on every re-run.

INSERT INTO exchange_rates (from_ccy, to_ccy, rate, source)
SELECT 'USD', 'KES', 130, 'manual'
WHERE NOT EXISTS (
  SELECT 1 FROM exchange_rates WHERE from_ccy = 'USD' AND to_ccy = 'KES'
);


-- ============================================================================
--  End of script.
-- ============================================================================
