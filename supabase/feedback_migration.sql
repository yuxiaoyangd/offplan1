-- 骑手满意度反馈表
-- 城市由服务端根据请求 IP 推断后写入，不保存原始 IP。

create table if not exists public.rider_feedback (
  id uuid primary key default gen_random_uuid(),
  city text not null check (char_length(trim(city)) between 1 and 40),
  income_satisfaction smallint not null check (income_satisfaction between 1 and 5),
  management_satisfaction smallint not null check (management_satisfaction between 1 and 5),
  other_feedback text check (other_feedback is null or char_length(other_feedback) <= 2000),
  rider_name text check (rider_name is null or char_length(trim(rider_name)) between 1 and 40),
  created_at timestamptz not null default now()
);

create index if not exists idx_rider_feedback_created_at
  on public.rider_feedback (created_at desc);

create index if not exists idx_rider_feedback_city
  on public.rider_feedback (city);

alter table public.rider_feedback enable row level security;

drop policy if exists "rider feedback insert" on public.rider_feedback;
create policy "rider feedback insert"
on public.rider_feedback
for insert to anon, authenticated
with check (true);

grant insert on public.rider_feedback to anon, authenticated;
