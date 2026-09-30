-- Jalankan sekali di Supabase SQL Editor setelah supabase-schema.sql.
-- Tabel ini menyimpan detail kendaraan dari layar Status SPOS, NPP, atau NTP SIAPP per nopol.
-- Nomor HP, email, dan NIK tidak disimpan oleh integrasi ini.

create table if not exists public.vehicle_details (
  plate_key text primary key,
  plate_number text not null,
  owner_name text not null default '',
  address text not null default '',
  district_village text not null default '',
  phone text not null default '',
  vehicle_type text not null default '',
  brand_model text not null default '',
  manufacture_year_color text not null default '',
  source_letter_type text not null default '',
  kohir text not null default '',
  tax_valid_date date,
  stnk_valid_date date,
  letter_date date,
  ntp_date date,
  pkb_amount numeric not null default 0,
  opsen_amount numeric not null default 0,
  total_amount numeric not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.vehicle_details
  add column if not exists phone text not null default '';

alter table public.vehicle_details
  add column if not exists source_letter_type text not null default '';

alter table public.vehicle_details
  add column if not exists letter_date date;

update public.vehicle_details
set letter_date = coalesce(letter_date, ntp_date)
where letter_date is null and ntp_date is not null;

create index if not exists vehicle_details_updated_at_idx
on public.vehicle_details (updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists vehicle_details_set_updated_at on public.vehicle_details;
create trigger vehicle_details_set_updated_at
before insert or update on public.vehicle_details
for each row execute function public.set_updated_at();

alter table public.vehicle_details enable row level security;

drop policy if exists vehicle_details_public_access on public.vehicle_details;
create policy vehicle_details_public_access
on public.vehicle_details
for all
to anon
using (true)
with check (true);
