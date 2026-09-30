-- Separate weekly budget (was derived from the monthly one) and a search distance setting.
alter table public.user_prefs
  add column weekly_budget numeric(8,2) not null default 50,
  add column search_radius_mi smallint not null default 5 check (search_radius_mi in (2, 5, 10, 20));

-- Start existing users' weekly budget at their monthly budget spread over the year.
update public.user_prefs set weekly_budget = round(monthly_budget * 12 / 52);

-- Which areas nearby-prices has fetched from Google, so a wider search is not
-- mistaken for fresh just because the smaller area inside it is. Written by the
-- edge function only (service role); no client access.
create table public.nearby_fetches (
  id bigint generated always as identity primary key,
  lat double precision not null,
  lng double precision not null,
  radius_m integer not null,
  fetched_at timestamptz not null default now()
);
create index nearby_fetches_fetched_at on public.nearby_fetches (fetched_at);
alter table public.nearby_fetches enable row level security;
