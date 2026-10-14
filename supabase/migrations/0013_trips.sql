-- Mileage log. Holds what the IRS asks you to keep for each trip: date, miles, where you went, and why.
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  vehicle_id uuid references public.vehicles (id) on delete set null,
  trip_date date not null,
  purpose text not null check (purpose in ('business', 'medical', 'charity', 'personal')),
  miles numeric(7, 1) not null check (miles > 0 and miles < 5000),
  odo_start integer,
  odo_end integer,
  origin text,
  destination text,
  note text,
  created_at timestamptz not null default now(),
  check (odo_start is null or odo_end is null or odo_end > odo_start)
);
create index trips_user_date on public.trips (user_id, trip_date desc);
alter table public.trips enable row level security;
create policy "own trips" on public.trips for all
  using ((user_id = (select auth.uid())) and (select private.is_allowed()))
  with check ((user_id = (select auth.uid())) and (select private.is_allowed()));
