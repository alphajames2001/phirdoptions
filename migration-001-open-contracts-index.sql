-- Run this on the live database BEFORE deploying the new code.
-- CONCURRENTLY avoids locking the contracts table while the index builds.
-- It cannot run inside a transaction: in the Supabase SQL editor, run this
-- statement on its own.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contracts_open_symbol
  ON contracts (symbol, entry_tick)
  WHERE status = 'open';

-- Optional: confirm the planner uses it.
-- EXPLAIN ANALYZE
--   SELECT id FROM contracts WHERE status = 'open' AND symbol = 'V20_1S' AND entry_tick <= 100000;
