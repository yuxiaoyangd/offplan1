-- 断签统计表单及提交记录。现有排班表不受影响。
create table if not exists public.contract_end_forms (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  is_open boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_contract_end_forms_created_at
  on public.contract_end_forms (created_at desc);

create table if not exists public.contract_end_submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.contract_end_forms(id),
  rider_name text not null check (char_length(trim(rider_name)) between 1 and 40),
  satisfaction smallint not null check (satisfaction between 1 and 5),
  reason text not null check (reason in ('income', 'workload', 'management', 'other_job', 'personal', 'other')),
  details text check (details is null or char_length(details) <= 1000),
  created_at timestamptz not null default now(),
  check (reason <> 'other' or (details is not null and char_length(trim(details)) > 0))
);

create index if not exists idx_contract_end_submissions_form_created_at
  on public.contract_end_submissions (form_id, created_at desc);

alter table public.contract_end_forms enable row level security;
alter table public.contract_end_submissions enable row level security;

drop policy if exists "contract end forms read" on public.contract_end_forms;
create policy "contract end forms read" on public.contract_end_forms
  for select to anon, authenticated using (true);

drop policy if exists "contract end forms create" on public.contract_end_forms;
create policy "contract end forms create" on public.contract_end_forms
  for insert to anon, authenticated with check (true);

drop policy if exists "contract end forms update" on public.contract_end_forms;
create policy "contract end forms update" on public.contract_end_forms
  for update to anon, authenticated using (true) with check (true);

drop policy if exists "contract end submissions insert while open" on public.contract_end_submissions;
create policy "contract end submissions insert while open" on public.contract_end_submissions
  for insert to anon, authenticated
  with check (exists (
    select 1 from public.contract_end_forms
    where id = form_id and is_open = true
  ));

-- 与现有后台一致：结果在无需登录的管理页中可读取。
drop policy if exists "contract end submissions read" on public.contract_end_submissions;
create policy "contract end submissions read" on public.contract_end_submissions
  for select to anon, authenticated using (true);

grant select, insert, update on public.contract_end_forms to anon, authenticated;
grant select, insert on public.contract_end_submissions to anon, authenticated;
