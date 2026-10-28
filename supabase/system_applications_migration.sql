-- 首页免费申请：与骑手满意度反馈分开保存。
create extension if not exists pgcrypto;

create table if not exists public.system_applications (
  id uuid primary key default gen_random_uuid(),
  company_size integer not null check (company_size between 1 and 1000000),
  contact_name text not null check (char_length(trim(contact_name)) between 1 and 40),
  contact_email text check (
    contact_email is null or (
      char_length(contact_email) between 3 and 254
      and contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  ),
  contact_phone text check (
    contact_phone is null or (
      char_length(contact_phone) <= 30
      and contact_phone ~ '^\+?[0-9() -]+$'
      and char_length(regexp_replace(contact_phone, '[^0-9]', '', 'g')) between 7 and 15
    )
  ),
  created_at timestamptz not null default now(),
  constraint system_applications_one_contact check (num_nonnulls(contact_email, contact_phone) = 1)
);

create index if not exists idx_system_applications_created_at
  on public.system_applications (created_at desc);

alter table public.system_applications enable row level security;

drop policy if exists "system applications insert" on public.system_applications;
create policy "system applications insert"
  on public.system_applications
  for insert to anon, authenticated
  with check (true);

grant insert on public.system_applications to anon, authenticated;
