-- 编辑配置中的排班规则一次保存；仅更新配置，不改动已有排班记录。
create or replace function public.save_week_slot_rules(
  p_week_id uuid,
  p_required_slots int,
  p_default_slot_ids uuid[],
  p_slot_ids uuid[],
  p_selectable_flags boolean[]
)
returns jsonb language plpgsql
as $$
declare
  v_slot_count int;
  v_requested_count int;
  v_default_count int;
begin
  perform 1 from public.schedule_weeks where id = p_week_id for update;
  if not found then
    return jsonb_build_object('success', false, 'message', '排班周不存在');
  end if;

  if p_required_slots is null or p_required_slots < 0 or p_required_slots > 10 then
    return jsonb_build_object('success', false, 'message', '必选时段数需在 0 到 10 之间');
  end if;

  if p_slot_ids is null or p_selectable_flags is null then
    return jsonb_build_object('success', false, 'message', '时段数据不完整');
  end if;
  v_requested_count := coalesce(array_length(p_slot_ids, 1), 0);
  if v_requested_count <> coalesce(array_length(p_selectable_flags, 1), 0)
    or array_position(p_slot_ids, null) is not null
    or array_position(p_selectable_flags, null) is not null then
    return jsonb_build_object('success', false, 'message', '时段数据不完整');
  end if;

  select count(*) into v_slot_count from public.time_slots where week_id = p_week_id;
  if v_slot_count <> v_requested_count
    or (select count(distinct slot_id) from unnest(p_slot_ids) as requested(slot_id)) <> v_requested_count
    or exists (
      select 1
      from unnest(p_slot_ids) as requested(slot_id)
      left join public.time_slots ts on ts.id = requested.slot_id and ts.week_id = p_week_id
      where ts.id is null
    ) then
    return jsonb_build_object('success', false, 'message', '时段配置已变化，请刷新后重试');
  end if;

  v_default_count := coalesce(array_length(p_default_slot_ids, 1), 0);
  if v_default_count > p_required_slots
    or (select count(distinct slot_id) from unnest(coalesce(p_default_slot_ids, array[]::uuid[])) as defaults(slot_id)) <> v_default_count
    or exists (
      select 1
      from unnest(coalesce(p_default_slot_ids, array[]::uuid[])) as defaults(slot_id)
      left join unnest(p_slot_ids, p_selectable_flags) as desired(slot_id, is_selectable)
        on desired.slot_id = defaults.slot_id
      where desired.slot_id is null or desired.is_selectable is not true
    ) then
    return jsonb_build_object('success', false, 'message', '默认时段必须是本周已开启的可选时段，且数量不能超过必选数量');
  end if;

  update public.time_slots ts
  set is_selectable = desired.is_selectable
  from unnest(p_slot_ids, p_selectable_flags) as desired(slot_id, is_selectable)
  where ts.id = desired.slot_id and ts.week_id = p_week_id
    and ts.is_selectable is distinct from desired.is_selectable;

  update public.schedule_weeks
  set required_slots = p_required_slots,
      default_slot_ids = coalesce(p_default_slot_ids, array[]::uuid[])
  where id = p_week_id;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.save_week_slot_rules to anon, authenticated;
