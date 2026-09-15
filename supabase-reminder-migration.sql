-- Jalankan sekali di Supabase: SQL Editor > New query > Run.
-- Menambahkan riwayat reminder WhatsApp tanpa mengubah tabel data yang ada.

create table if not exists public.whatsapp_reminders (
  id text primary key,
  taxpayer_id text references public.taxpayers(id) on delete set null,
  plate_key text not null,
  reminder_number smallint not null check (reminder_number between 1 and 10),
  template_version smallint not null check (template_version between 1 and 10),
  sent_at timestamptz not null default now()
);

create index if not exists whatsapp_reminders_plate_key_sent_at_idx
on public.whatsapp_reminders (plate_key, sent_at desc);

alter table public.whatsapp_reminders enable row level security;

drop policy if exists whatsapp_reminders_public_access on public.whatsapp_reminders;
create policy whatsapp_reminders_public_access
on public.whatsapp_reminders
for all
to anon
using (true)
with check (true);
