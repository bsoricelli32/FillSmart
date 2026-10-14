-- Web Push alerts: one row per phone or browser that allowed notifications.
create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "own subscriptions" on public.push_subscriptions for all
  using ((user_id = (select auth.uid())) and (select private.is_allowed()))
  with check ((user_id = (select auth.uid())) and (select private.is_allowed()));

-- Where to watch prices for the drop alert, and the user's time zone for the Sunday report.
alter table public.user_prefs
  add column alert_lat double precision,
  add column alert_lng double precision,
  add column alert_label text,
  add column tz text;

-- Server-only bookkeeping so an alert or report is never sent twice. RLS on with no policies:
-- only the service role (edge functions) can read or write these.
create table public.alert_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_alert_price numeric,
  last_alert_place text,
  last_alert_at timestamptz,
  last_report_at timestamptz
);
alter table public.alert_state enable row level security;

-- VAPID keys for signing pushes. The private key is inserted directly, never committed.
create table public.push_config (
  id smallint primary key default 1 check (id = 1),
  public_key text not null,
  private_key text not null,
  subject text not null,
  job_token text not null default encode(gen_random_bytes(24), 'hex') -- scheduled jobs must send this
);
alter table public.push_config enable row level security;
revoke all on public.alert_state, public.push_config from anon, authenticated;
