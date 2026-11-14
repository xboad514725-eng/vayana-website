-- VAYANA request flow updates — 2026-11-14
-- Applied to the connected Supabase project before recording this migration.
-- All additions are nullable to preserve existing request records.

alter table public.gift_requests
  alter column gift_date drop not null;

alter table public.tour_requests
  add column if not exists arrival_flight_date date,
  add column if not exists departure_flight_date date,
  add column if not exists airport_transfer_type text,
  add column if not exists airport_pickup_date date,
  add column if not exists airport_dropoff_date date;

alter table public.offer_requests
  alter column pickup_date drop not null,
  alter column pickup_location_type drop not null,
  add column if not exists dropoff_date date,
  add column if not exists dropoff_location_type text,
  add column if not exists airport_transfer_type text;
