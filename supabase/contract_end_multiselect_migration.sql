-- 断签原因多选；删除按钮在开启和关闭状态均可使用。
alter table public.contract_end_submissions
  add column if not exists selected_reasons jsonb;

update public.contract_end_submissions
set selected_reasons = jsonb_build_array(jsonb_build_object('id', reason, 'label', reason_label))
where selected_reasons is null;

alter table public.contract_end_submissions
  alter column selected_reasons set not null;
alter table public.contract_end_submissions
  drop constraint if exists contract_end_submissions_selected_reasons_check;
alter table public.contract_end_submissions
  add constraint contract_end_submissions_selected_reasons_check check (
    case when jsonb_typeof(selected_reasons) = 'array'
      then jsonb_array_length(selected_reasons) between 1 and 20
      else false
    end
  );

drop policy if exists "contract end submissions insert while open" on public.contract_end_submissions;
create policy "contract end submissions insert while open" on public.contract_end_submissions
  for insert to anon, authenticated
  with check (exists (
    select 1 from public.contract_end_forms f
    where f.id = form_id
      and f.is_open = true
      and reason = selected_reasons->0->>'id'
      and reason_label = selected_reasons->0->>'label'
      and (
        select count(distinct chosen.value->>'id')
        from jsonb_array_elements(selected_reasons) as chosen(value)
      ) = jsonb_array_length(selected_reasons)
      and not exists (
        select 1
        from jsonb_array_elements(selected_reasons) as chosen(value)
        where not exists (
          select 1
          from jsonb_array_elements(f.reasons) as configured(value)
          where configured.value->>'id' = chosen.value->>'id'
            and configured.value->>'label' = chosen.value->>'label'
        )
      )
      and (
        not exists (
          select 1 from jsonb_array_elements(selected_reasons) as chosen(value)
          where chosen.value->>'label' = '其他原因'
        )
        or (details is not null and char_length(trim(details)) > 0)
      )
  ));

drop policy if exists "contract end forms delete when closed" on public.contract_end_forms;
create policy "contract end forms delete when closed" on public.contract_end_forms
  for delete to anon, authenticated using (true);
