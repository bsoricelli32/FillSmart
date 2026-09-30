-- Already applied to the live project. Renames the sign-up block message to FillSmart.
create or replace function private.enforce_allowlist()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if not exists (select 1 from public.allowlist where email = lower(new.email)) then
    raise exception 'This email is not invited to FillSmart';
  end if;
  return new;
end;
$function$;
