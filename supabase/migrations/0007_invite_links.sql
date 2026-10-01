-- Shareable invite link: sign-ups carrying a valid invite code are let in and added to the allowlist.
-- Emails already on the allowlist still work without a code.
-- To turn the current link off and make a new one:
--   update private.invite_codes set active = false;
--   insert into private.invite_codes (code) values (substr(md5(random()::text), 1, 10));

create table private.invite_codes (
  code text primary key,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into private.invite_codes (code) values (substr(md5(random()::text), 1, 10));

create or replace function private.enforce_allowlist()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if exists (select 1 from public.allowlist where email = lower(new.email)) then
    return new;
  end if;
  if exists (select 1 from private.invite_codes c
             where c.active and c.code = coalesce(new.raw_user_meta_data ->> 'invite', '')) then
    insert into public.allowlist (email) values (lower(new.email)) on conflict do nothing;
    return new;
  end if;
  raise exception 'This email is not invited to FillSmart';
end;
$function$;

-- Lets a signed-in, allowed user read the current code so the app can build the share link.
create or replace function public.invite_code()
 returns text
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select c.code from private.invite_codes c
  where c.active and private.is_allowed()
  order by c.created_at desc limit 1;
$function$;
revoke all on function public.invite_code() from public, anon;
grant execute on function public.invite_code() to authenticated;
