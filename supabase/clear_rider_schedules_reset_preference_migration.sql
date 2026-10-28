-- 更新清空排班逻辑；只替换函数，不修改现有排班数据。
create or replace function public.bulk_clear_rider_schedules(
  p_week_id uuid,
  p_rider_ids text[]
)
returns jsonb language plpgsql
as $$
declare
  v_removed integer;
begin
  if p_rider_ids is null or array_length(p_rider_ids, 1) is null then
    return jsonb_build_object('success', false, 'message', '未提供骑手名单');
  end if;

  update public.riders
  set rest_preference_mode = null,
      preference_submitted_at = null
  where week_id = p_week_id
    and rider_id = any(p_rider_ids);

  delete from public.rider_schedules
  where week_id = p_week_id
    and rider_id = any(p_rider_ids);
  get diagnostics v_removed = row_count;

  return jsonb_build_object('success', true, 'removed', v_removed);
end;
$$;
