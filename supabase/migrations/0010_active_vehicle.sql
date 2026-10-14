-- Which vehicle the app uses for fill costs, detours and octane advice.
alter table public.user_prefs
  add column vehicle_id uuid references public.vehicles (id) on delete set null;
