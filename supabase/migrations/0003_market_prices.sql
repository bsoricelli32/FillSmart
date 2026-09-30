-- Regional and wholesale price history from the U.S. EIA, used by the Outlook forecast.
-- Written only by the eia-sync edge function (service role). Read by allowed users.
create table public.market_prices (
  series     text not null,
  period     date not null,
  value      numeric(6,3) not null,
  fetched_at timestamptz not null default now(),
  primary key (series, period)
);

alter table public.market_prices enable row level security;

create policy "allowed users read market prices" on public.market_prices
  for select to authenticated using ((select private.is_allowed()));

-- Scheduling: pg_cron runs the job, pg_net makes the HTTP call.
create extension if not exists pg_cron;
create extension if not exists pg_net;
