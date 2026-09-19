-- 将“套用指定时段”升级为多时段完全替换。
-- 仅更新数据库函数，不修改任何已有排班数据。

drop function if exists public.bulk_apply_slot(uuid, text[], uuid);
drop function if exists public.bulk_apply_slot(uuid, text[], uuid[]);

create or replace function public.bulk_apply_slot(
  p_week_id uuid,
  p_rider_ids text[],
  p_slot_ids uuid[]
)
returns jsonb language plpgsql
as $$
declare
  v_start date;
  v_end date;
  v_day date;
  v_rider text;
  v_processed integer := 0;
  v_skipped integer := 0;
  v_has_rest boolean;
  v_valid_slot_count integer;
  v_slot_id uuid;
begin
  select start_date, end_date into v_start, v_end
  from public.schedule_weeks where id = p_week_id;

  if p_rider_ids is null or array_length(p_rider_ids, 1) is null then
    return jsonb_build_object('success', false, 'message', '未提供骑手名单');
  end if;

  if p_slot_ids is null or array_length(p_slot_ids, 1) is null then
    return jsonb_build_object('success', false, 'message', '未提供出勤时段');
  end if;

  select count(distinct ts.id) into v_valid_slot_count
  from public.time_slots ts
  where ts.week_id = p_week_id
    and ts.is_active
    and ts.is_selectable
    and ts.id = any(p_slot_ids);

  if v_valid_slot_count <> array_length(p_slot_ids, 1) then
    return jsonb_build_object('success', false, 'message', '出勤时段无效、不可选或存在重复');
  end if;

  for v_rider in select unnest(p_rider_ids)
  loop
    v_day := v_start;
    while v_day <= v_end loop
      select exists(
        select 1 from public.rider_schedules
        where week_id = p_week_id
          and rider_id = v_rider
          and work_date = v_day
          and slot_id is null
      ) into v_has_rest;

      if v_has_rest then
        v_skipped := v_skipped + 1;
      else
        delete from public.rider_schedules
        where week_id = p_week_id
          and rider_id = v_rider
          and work_date = v_day
          and slot_id is not null;

        foreach v_slot_id in array p_slot_ids
        loop
          insert into public.rider_schedules (rider_id, week_id, work_date, slot_id, is_selected)
          values (v_rider, p_week_id, v_day, v_slot_id, true);
        end loop;
        v_processed := v_processed + 1;
      end if;

      v_day := v_day + interval '1 day';
    end loop;
  end loop;

  return jsonb_build_object('success', true, 'processed', v_processed, 'skipped', v_skipped);
end;
$$;
