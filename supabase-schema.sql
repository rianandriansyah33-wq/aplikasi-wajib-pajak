-- Jalankan seluruh file ini sekali di Supabase: SQL Editor > New query > Run.
-- Akses data wajib pajak dikunci hanya untuk email pemilik aplikasi.

create table if not exists public.taxpayers (
  id text primary key,
  plate_key text not null unique,
  letter_type text not null default '',
  tax_valid_date date,
  plate_number text not null,
  owner_name text not null default '',
  tax_potential numeric not null default 0,
  phone text not null default '',
  status text not null default 'Belum bayar',
  field_visit_date date,
  field_visit_note text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.production_records (
  id text primary key,
  letter_type text not null,
  month integer not null,
  year integer not null,
  plate_number text not null,
  plate_key text not null,
  owner_name text not null default '',
  entry_number text not null default '',
  status text not null default 'Belum terdeteksi lunas',
  is_paid boolean not null default false,
  paid_date date,
  recorded_date date,
  tax_valid_date date,
  tax_base_amount numeric not null default 0,
  jasa_raharja numeric not null default 0,
  late_penalty numeric not null default 0,
  calculated_tax_potential numeric not null default 0,
  source_text text not null default '',
  updated_at timestamptz not null default now(),
  unique (letter_type, year, month, plate_key)
);

create index if not exists taxpayers_updated_at_idx on public.taxpayers (updated_at desc);
create index if not exists production_records_plate_key_idx on public.production_records (plate_key);
create index if not exists production_records_updated_at_idx on public.production_records (updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists taxpayers_set_updated_at on public.taxpayers;
create trigger taxpayers_set_updated_at
before insert or update on public.taxpayers
for each row execute function public.set_updated_at();

drop trigger if exists production_records_set_updated_at on public.production_records;
create trigger production_records_set_updated_at
before insert or update on public.production_records
for each row execute function public.set_updated_at();

alter table public.taxpayers enable row level security;
alter table public.production_records enable row level security;

drop policy if exists taxpayer_owner_only on public.taxpayers;
create policy taxpayer_owner_only
on public.taxpayers
for all
to authenticated
using ((auth.jwt() ->> 'email') = 'rianandriansyah33@gmail.com')
with check ((auth.jwt() ->> 'email') = 'rianandriansyah33@gmail.com');

drop policy if exists production_owner_read on public.production_records;
create policy production_owner_read
on public.production_records
for select
to authenticated
using ((auth.jwt() ->> 'email') = 'rianandriansyah33@gmail.com');

drop policy if exists production_owner_write on public.production_records;
create policy production_owner_write
on public.production_records
for all
to authenticated
using ((auth.jwt() ->> 'email') = 'rianandriansyah33@gmail.com')
with check ((auth.jwt() ->> 'email') = 'rianandriansyah33@gmail.com');

-- Bookmark SIAPP perlu menulis hasil sinkron tanpa sesi login browser aplikasi.
-- Ia tidak memperoleh izin membaca data apa pun.
drop policy if exists production_sync_insert on public.production_records;
create policy production_sync_insert
on public.production_records
for insert
to anon
with check (true);

drop policy if exists production_sync_update on public.production_records;
create policy production_sync_update
on public.production_records
for update
to anon
using (true)
with check (true);

create or replace view public.production_summary
with (security_invoker = true)
as
select
  count(*)::integer as count,
  count(*) filter (where is_paid)::integer as paid_count,
  count(*) filter (where not is_paid)::integer as unpaid_count,
  max(updated_at) as latest_update
from public.production_records;

grant select on public.production_summary to authenticated;
