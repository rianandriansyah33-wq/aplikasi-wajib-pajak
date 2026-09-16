-- Jalankan seluruh file ini di Supabase: SQL Editor > New query > Run.
-- Aplikasi memakai akses langsung tanpa login email. Jangan bagikan URL aplikasi
-- kepada umum karena data dapat dibaca dan diubah oleh pengguna aplikasi.

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

create table if not exists public.field_visit_assignments (
  id text primary key,
  taxpayer_id text not null references public.taxpayers(id) on delete cascade,
  plate_key text not null,
  plate_number text not null,
  owner_name text not null default '',
  letter_type text not null,
  production_record_id text not null,
  production_recorded_date date not null,
  field_visit_date date not null,
  field_visit_note text not null default '',
  snapshot_tax_potential numeric not null default 0,
  assignment_source text not null default 'saved_snapshot' check (assignment_source in ('historical_match', 'saved_snapshot')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (taxpayer_id, production_record_id)
);

create table if not exists public.whatsapp_reminders (
  id text primary key,
  taxpayer_id text references public.taxpayers(id) on delete set null,
  plate_key text not null,
  reminder_number smallint not null check (reminder_number between 1 and 10),
  template_version smallint not null check (template_version between 1 and 10),
  sent_at timestamptz not null default now()
);

create index if not exists taxpayers_updated_at_idx on public.taxpayers (updated_at desc);
create index if not exists production_records_plate_key_idx on public.production_records (plate_key);
create index if not exists production_records_updated_at_idx on public.production_records (updated_at desc);
create index if not exists field_visit_assignments_plate_key_idx on public.field_visit_assignments (plate_key);
create index if not exists field_visit_assignments_production_record_id_idx on public.field_visit_assignments (production_record_id);
create index if not exists whatsapp_reminders_plate_key_sent_at_idx on public.whatsapp_reminders (plate_key, sent_at desc);

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

drop trigger if exists field_visit_assignments_set_updated_at on public.field_visit_assignments;
create trigger field_visit_assignments_set_updated_at
before insert or update on public.field_visit_assignments
for each row execute function public.set_updated_at();

alter table public.taxpayers enable row level security;
alter table public.production_records enable row level security;
alter table public.field_visit_assignments enable row level security;
alter table public.whatsapp_reminders enable row level security;

-- Hapus kebijakan versi lama, lalu izinkan aplikasi tanpa login membaca dan
-- memperbarui kedua tabel melalui publishable key.
drop policy if exists taxpayer_owner_only on public.taxpayers;
drop policy if exists taxpayer_public_access on public.taxpayers;
create policy taxpayer_public_access
on public.taxpayers
for all
to anon
using (true)
with check (true);

drop policy if exists production_owner_read on public.production_records;
drop policy if exists production_owner_write on public.production_records;
drop policy if exists production_sync_insert on public.production_records;
drop policy if exists production_sync_update on public.production_records;
drop policy if exists production_public_access on public.production_records;
create policy production_public_access
on public.production_records
for all
to anon
using (true)
with check (true);

drop policy if exists field_visit_assignments_public_access on public.field_visit_assignments;
create policy field_visit_assignments_public_access
on public.field_visit_assignments
for all
to anon
using (true)
with check (true);

drop policy if exists whatsapp_reminders_public_access on public.whatsapp_reminders;
create policy whatsapp_reminders_public_access
on public.whatsapp_reminders
for all
to anon
using (true)
with check (true);

-- Bentuk snapshot surat dari data DL lama. Record yang dipilih adalah surat
-- SIAPP terakhir yang sudah terekam pada atau sebelum tanggal DL tersebut.
-- Surat yang terbit setelah tanggal DL tidak masuk ke atribusi pencairan.
insert into public.field_visit_assignments (
  id,
  taxpayer_id,
  plate_key,
  plate_number,
  owner_name,
  letter_type,
  production_record_id,
  production_recorded_date,
  field_visit_date,
  field_visit_note,
  snapshot_tax_potential,
  assignment_source
)
select
  'dl-' || regexp_replace(t.id, '[^A-Za-z0-9_-]', '', 'g') || '-' || regexp_replace(p.id, '[^A-Za-z0-9_-]', '', 'g'),
  t.id,
  t.plate_key,
  t.plate_number,
  coalesce(p.owner_name, t.owner_name, ''),
  p.letter_type,
  p.id,
  p.recorded_date,
  t.field_visit_date,
  t.field_visit_note,
  p.calculated_tax_potential,
  'historical_match'
from public.taxpayers t
cross join lateral (
  select pr.*
  from public.production_records pr
  where pr.plate_key = t.plate_key
    and pr.recorded_date is not null
    and pr.recorded_date <= t.field_visit_date
  order by
    pr.recorded_date desc,
    case pr.letter_type when 'NTP' then 3 when 'NPP' then 2 when 'SPOS' then 1 else 0 end desc,
    pr.updated_at desc
  limit 1
) p
where t.field_visit_date is not null
on conflict (taxpayer_id, production_record_id) do nothing;

create or replace view public.production_summary
with (security_invoker = true)
as
select
  count(*)::integer as count,
  count(*) filter (where is_paid)::integer as paid_count,
  count(*) filter (where not is_paid)::integer as unpaid_count,
  max(updated_at) as latest_update
from public.production_records;

grant select on public.production_summary to anon;
