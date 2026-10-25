-- Function that runs whenever a new user is created
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Create demo + real accounts
  insert into public.accounts (user_id, type, balance)
  values
    (new.id, 'demo', 10000),
    (new.id, 'real', 0)
  on conflict (user_id, type) do nothing;

  -- Create KYC submission record
  insert into public.kyc_submissions (user_id, status)
  values (new.id, 'pending')
  on conflict (user_id) do nothing;

  -- Set default role
  insert into public.user_roles (user_id, role)
  values (new.id, 'user')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- Trigger that fires the function after every insert into auth.users
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();