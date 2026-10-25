-- trade_rpcs.sql
-- Consolidates the trade path into single Postgres function calls.
-- Run this in the Supabase SQL editor AFTER schema.sql, trigger.sql,
-- roles.sql and profiles.sql.
--
-- Why this exists:
--   The trade path used to spend 3-4 sequential HTTP round trips to
--   PostgREST per trade (deduct balance -> insert stake transaction ->
--   insert contract, and 4 more per settlement). Each one is a network
--   hop from the API to the database. Folding them into a single
--   function call collapses that into one hop.
--
--   It also closes a real bug: the deduction and the contract insert
--   were separate calls, so a failed insert left the stake deducted
--   with no contract and no rollback. place_trade() does both inside
--   one transaction, so that can no longer happen.

-- ── place_trade ─────────────────────────────────────────────────────
-- Atomically: check + deduct the stake, record the stake transaction,
-- and create the open contract.
--
-- The payout multiplier itself is NOT recomputed here. market.js is the
-- single source of truth for PAYOUT_MULTIPLIERS (including the
-- over/under edge case), so the calculated payout is passed in.
--
-- Raises 'INSUFFICIENT_BALANCE' when the account cannot cover the
-- stake - the caller maps that to a 400.

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

-- ── settle_contracts ────────────────────────────────────────────────
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
