-- Jalankan sekali di Supabase: SQL Editor > New query > Run.
-- Migrasi ini membuat riwayat surat DL yang menjadi dasar atribusi pencairan.

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

create index if not exists field_visit_assignments_plate_key_idx
on public.field_visit_assignments (plate_key);

create index if not exists field_visit_assignments_production_record_id_idx
on public.field_visit_assignments (production_record_id);

drop trigger if exists field_visit_assignments_set_updated_at on public.field_visit_assignments;
create trigger field_visit_assignments_set_updated_at
before insert or update on public.field_visit_assignments
for each row execute function public.set_updated_at();

alter table public.field_visit_assignments enable row level security;

drop policy if exists field_visit_assignments_public_access on public.field_visit_assignments;
create policy field_visit_assignments_public_access
on public.field_visit_assignments
for all
to anon
using (true)
with check (true);

-- Backfill riwayat dari data DL yang sudah ada. Surat dicocokkan berdasarkan
-- nopol dan tanggal rekam SIAPP yang tidak melewati tanggal DL.
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
