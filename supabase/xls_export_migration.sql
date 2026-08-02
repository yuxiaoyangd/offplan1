-- 为现有数据库增加原始 Excel 存储能力。
-- 此迁移不会删除排班表或现有业务数据。

begin;

alter table public.week_import_snapshots
  add column if not exists original_file_path text,
  add column if not exists original_file_name text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'xls-templates',
  'xls-templates',
  false,
  10485760,
  array[
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream'
  ]::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "xls templates select" on storage.objects;
drop policy if exists "xls templates insert" on storage.objects;
drop policy if exists "xls templates delete" on storage.objects;

create policy "xls templates select"
on storage.objects for select to anon, authenticated
using (bucket_id = 'xls-templates');

create policy "xls templates insert"
on storage.objects for insert to anon, authenticated
with check (bucket_id = 'xls-templates');

create policy "xls templates delete"
on storage.objects for delete to anon, authenticated
using (bucket_id = 'xls-templates');

commit;
