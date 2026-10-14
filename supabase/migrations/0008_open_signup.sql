-- Open sign-up: anyone can create an account. Every new account is added to the allowlist,
-- so all existing row-level security (private.is_allowed) keeps working unchanged.
-- To go back to invite-only, restore the function from 0007_invite_links.sql.
create or replace function private.enforce_allowlist()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  insert into public.allowlist (email) values (lower(new.email)) on conflict do nothing;
  return new;
end;
$function$;

-- Make sure every existing account is on the list too.
insert into public.allowlist (email)
select lower(email) from auth.users where email is not null
on conflict do nothing;
