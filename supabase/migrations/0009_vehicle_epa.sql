-- Official EPA (fueleconomy.gov) data for each vehicle, filled in by the Garage vehicle picker.
alter table public.vehicles
  add column year smallint,
  add column make text,
  add column model text,
  add column epa_id integer,
  add column engine text,
  add column mpg_combined numeric(5,2),
  add column mpg_city numeric(5,2),
  add column mpg_highway numeric(5,2),
  add column epa_fuel text; -- "Regular Gasoline", "Premium Gasoline", "Midgrade Gasoline", "Diesel", ...
