-- 在断签统计表单中编辑原因，并允许删除已关闭的表单及其提交记录。
alter table public.contract_end_forms
  add column if not exists reasons jsonb not null default '[
    {"id":"income","label":"收入或结算","requiresDetails":false},
    {"id":"workload","label":"工作时间或强度","requiresDetails":false},
    {"id":"management","label":"管理与沟通","requiresDetails":false},
    {"id":"other_job","label":"转做其他工作","requiresDetails":false},
    {"id":"personal","label":"个人或家庭原因","requiresDetails":false},
    {"id":"other","label":"其他原因","requiresDetails":true}
  ]'::jsonb;

alter table public.contract_end_forms
  drop constraint if exists contract_end_forms_reasons_check;
alter table public.contract_end_forms
  add constraint contract_end_forms_reasons_check check (
    case when jsonb_typeof(reasons) = 'array'
      then jsonb_array_length(reasons) between 1 and 20
      else false
    end
  );

alter table public.contract_end_submissions
  add column if not exists reason_label text;

update public.contract_end_submissions
set reason_label = case reason
  when 'income' then '收入或结算'
  when 'workload' then '工作时间或强度'
  when 'management' then '管理与沟通'
  when 'other_job' then '转做其他工作'
  when 'personal' then '个人或家庭原因'
  when 'other' then '其他原因'
  else reason
end
where reason_label is null;

alter table public.contract_end_submissions
  alter column reason_label set not null;
alter table public.contract_end_submissions
  drop constraint if exists contract_end_submissions_reason_check;
alter table public.contract_end_submissions
  drop constraint if exists contract_end_submissions_check;
alter table public.contract_end_submissions
  add constraint contract_end_submissions_reason_check
  check (char_length(trim(reason)) between 1 and 80);
alter table public.contract_end_submissions
  drop constraint if exists contract_end_submissions_reason_label_check;
alter table public.contract_end_submissions
  add constraint contract_end_submissions_reason_label_check
  check (char_length(trim(reason_label)) between 1 and 80);

alter table public.contract_end_submissions
  drop constraint if exists contract_end_submissions_form_id_fkey;
alter table public.contract_end_submissions
  add constraint contract_end_submissions_form_id_fkey
  foreign key (form_id) references public.contract_end_forms(id) on delete cascade;

drop policy if exists "contract end submissions insert while open" on public.contract_end_submissions;
create policy "contract end submissions insert while open" on public.contract_end_submissions
  for insert to anon, authenticated
  with check (exists (
    select 1
    from public.contract_end_forms f,
         lateral jsonb_array_elements(f.reasons) as configured_reason(value)
    where f.id = form_id
      and f.is_open = true
      and configured_reason.value->>'id' = reason
      and configured_reason.value->>'label' = reason_label
      and (
        configured_reason.value->>'requiresDetails' = 'false'
        or (details is not null and char_length(trim(details)) > 0)
      )
  ));

drop policy if exists "contract end forms delete when closed" on public.contract_end_forms;
create policy "contract end forms delete when closed" on public.contract_end_forms
  for delete to anon, authenticated using (is_open = false);

grant delete on public.contract_end_forms to anon, authenticated;
