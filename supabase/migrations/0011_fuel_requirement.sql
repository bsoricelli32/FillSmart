-- What the owner's manual or fuel door says, answered once in Garage. The EPA lists only the fuel type,
-- not whether 85 is allowed at altitude or whether premium is required or just recommended.
alter table public.vehicles
  add column fuel_req text check (fuel_req in ('85_ok', '87_min', '91_required', '91_recommended'));
