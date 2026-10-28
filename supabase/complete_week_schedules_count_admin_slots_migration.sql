-- 自动补全将管理端套用的有效时段计入已有出勤，缺额仍只用默认可选时段补足。
create or replace function public.complete_week_schedules(p_week_id uuid)
returns jsonb language plpgsql
as $$
declare
  v_defaults uuid[];
  v_valid_defaults uuid[];
  v_required_slots integer;
  v_start date;
  v_end date;
  v_day date;
  v_rider record;
  v_team record;
  v_rest_date date;
  v_slot uuid;
  v_selected_count integer;
  v_rest_assigned integer := 0;
  v_rest_unassigned integer := 0;
  v_days_filled integer := 0;
  v_slots_added integer := 0;
begin
  select default_slot_ids, required_slots, start_date, end_date
  into v_defaults, v_required_slots, v_start, v_end
  from public.schedule_weeks
  where id = p_week_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'message', '排班周不存在');
  end if;

  if v_required_slots > 0 and coalesce(array_length(v_defaults, 1), 0) = 0 then
    return jsonb_build_object('success', false, 'message', '当前周未配置默认时段，请先到编辑配置中设置');
  end if;

  select array_agg(valid_default.id order by valid_default.first_ordinal)
  into v_valid_defaults
  from (
    select ts.id, min(defaults.ordinality) as first_ordinal
    from unnest(coalesce(v_defaults, array[]::uuid[])) with ordinality as defaults(slot_id, ordinality)
    join public.time_slots ts
      on ts.id = defaults.slot_id
     and ts.week_id = p_week_id
     and ts.is_active
     and ts.is_selectable
    group by ts.id
  ) valid_default;

  if coalesce(array_length(v_valid_defaults, 1), 0) < v_required_slots then
    return jsonb_build_object(
      'success', false,
      'message', '有效默认时段少于每天规定数量，请先完善默认时段配置'
    );
  end if;

  -- 先确保每个小队每天都有独立名额行，后续按剩余名额最多的日期分配。
  for v_team in
    select id from public.schedule_teams where week_id = p_week_id order by name, id
  loop
    v_day := v_start;
    while v_day <= v_end loop
      perform public.ensure_default_day_limit(p_week_id, v_team.id, v_day);
      v_day := v_day + 1;
    end loop;
  end loop;

  -- 随机排休优先，其余没有排休的人随后安排；同类按骑手编号稳定排序。
  for v_rider in
    select r.rider_id, r.team_id
    from public.riders r
    where r.week_id = p_week_id
      and r.is_active
      and not exists (
        select 1
        from public.rider_schedules rs
        where rs.week_id = p_week_id
          and rs.rider_id = r.rider_id
          and rs.slot_id is null
      )
    order by
      case r.rest_preference_mode when 'random' then 0 when 'specified' then 2 else 1 end,
      r.rider_id
  loop
    v_rest_date := null;

    select l.rest_date
    into v_rest_date
    from public.rest_day_limits l
    cross join lateral (
      select count(*)::integer as used
      from public.rider_schedules rs
      join public.riders used_rider
        on used_rider.week_id = rs.week_id
       and used_rider.rider_id = rs.rider_id
      where rs.week_id = p_week_id
        and used_rider.team_id = v_rider.team_id
        and rs.work_date = l.rest_date
        and rs.slot_id is null
    ) usage
    where l.week_id = p_week_id
      and l.team_id = v_rider.team_id
      and usage.used < l.max_slots
    order by (l.max_slots - usage.used) desc, l.rest_date
    limit 1
    for update of l;

    if v_rest_date is null then
      v_rest_unassigned := v_rest_unassigned + 1;
      continue;
    end if;

    delete from public.rider_schedules
    where week_id = p_week_id
      and rider_id = v_rider.rider_id
      and work_date = v_rest_date;

    insert into public.rider_schedules (rider_id, week_id, work_date, slot_id, is_selected)
    values (v_rider.rider_id, p_week_id, v_rest_date, null, null)
    on conflict (rider_id, week_id) where slot_id is null do nothing;

    v_rest_assigned := v_rest_assigned + 1;
  end loop;

  -- 再补时段：管理端套用的有效时段也算已有出勤，只从默认时段中补足缺额。
  for v_rider in
    select r.rider_id
    from public.riders r
    where r.week_id = p_week_id and r.is_active
    order by r.rider_id
  loop
    v_day := v_start;
    while v_day <= v_end loop
      if exists (
        select 1 from public.rider_schedules rs
        where rs.week_id = p_week_id
          and rs.rider_id = v_rider.rider_id
          and rs.work_date = v_day
          and rs.slot_id is null
      ) then
        v_day := v_day + 1;
        continue;
      end if;

      select count(*)::integer
      into v_selected_count
      from public.rider_schedules rs
      join public.time_slots ts on ts.id = rs.slot_id
      where rs.week_id = p_week_id
        and rs.rider_id = v_rider.rider_id
        and rs.work_date = v_day
        and rs.slot_id is not null
        and rs.is_selected is true
        and ts.week_id = p_week_id
        and ts.is_active;

      if v_selected_count < v_required_slots then
        v_days_filled := v_days_filled + 1;
        foreach v_slot in array coalesce(v_valid_defaults, array[]::uuid[])
        loop
          exit when v_selected_count >= v_required_slots;

          if not exists (
            select 1 from public.rider_schedules rs
            where rs.week_id = p_week_id
              and rs.rider_id = v_rider.rider_id
              and rs.work_date = v_day
              and rs.slot_id = v_slot
              and rs.is_selected is true
          ) then
            insert into public.rider_schedules (rider_id, week_id, work_date, slot_id, is_selected)
            values (v_rider.rider_id, p_week_id, v_day, v_slot, true)
            on conflict (rider_id, week_id, work_date, slot_id) where slot_id is not null
            do update set is_selected = true;

            v_selected_count := v_selected_count + 1;
            v_slots_added := v_slots_added + 1;
          end if;
        end loop;
      end if;

      v_day := v_day + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'success', true,
    'restAssigned', v_rest_assigned,
    'restUnassigned', v_rest_unassigned,
    'daysFilled', v_days_filled,
    'slotsAdded', v_slots_added
  );
end;
$$;
