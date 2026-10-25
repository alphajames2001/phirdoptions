-- Key/value settings, written only by the server (service role).
-- Used for the deposit provider choice (key = 'deposit_provider').
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- RLS on with no policies: only the service-role key can read or write it.
alter table public.app_settings enable row level security;

-- Optional: make the default explicit (the app already defaults to palpluss).
insert into public.app_settings (key, value)
values ('deposit_provider', 'palpluss')
on conflict (key) do nothing;
