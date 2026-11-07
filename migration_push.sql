-- Push notifications for influencer withdrawals

create table if not exists device_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  token       text not null unique,
  platform    text not null default 'android',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists device_tokens_user_idx on device_tokens(user_id);

-- Only the backend (service role) touches this table.
alter table device_tokens enable row level security;

-- Stored when a withdrawal is marked "sent", so the push notification and the
-- messages page show exactly the same text.
alter table influencer_withdrawals add column if not exists amount_kes   numeric(14,2);
alter table influencer_withdrawals add column if not exists message_text text;
