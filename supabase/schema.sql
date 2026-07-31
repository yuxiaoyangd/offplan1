-- ==========================================================
-- 排班系统数据库结构（基于骑手意愿导入 + 协同排班）
-- 每次执行会清空所有表后重建
-- ==========================================================

-- ==================== 1. 扩展 ====================
create extension if not exists pgcrypto;

-- ==================== 2. 清空旧数据 ====================
drop table if exists public.rest_week_members cascade;
drop table if exists public.rest_periods cascade;
drop table if exists public.employee_week_shifts cascade;
drop table if exists public.rider_schedules cascade;
drop table if exists public.week_import_snapshots cascade;
drop table if exists public.rider_week_rosters cascade;
drop table if exists public.time_slots cascade;
drop table if exists public.riders cascade;
drop table if exists public.rest_day_limits cascade;
drop table if exists public.schedule_teams cascade;
drop table if exists public.rest_weeks cascade;
drop table if exists public.schedule_weeks cascade;

-- 清理历史版本遗留的重载函数，避免授权阶段出现函数名不唯一
drop function if exists public.ensure_default_day_limit(date, date) cascade;
drop function if exists public.ensure_default_day_limit(uuid, date) cascade;
drop function if exists public.ensure_default_day_limit(uuid, uuid, date) cascade;
drop function if exists public.choose_random_rest_preference(text, uuid) cascade;
drop function if exists public.choose_random_rest_preference(text, uuid, uuid[]) cascade;
drop function if exists public.complete_week_schedules(uuid) cascade;

-- ==================== 3. 建表 ====================

-- 排班周
create table public.schedule_weeks (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  start_date date not null,
  end_date date not null,
  is_active boolean not null default true,
  required_slots int not null default 3 check (required_slots >= 0 and required_slots <= 10),
  default_slot_ids uuid[] default null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

-- 排班周小队；每个排班周始终至少有一个默认小队
create table public.schedule_teams (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references public.schedule_weeks(id) on delete cascade,
  external_group_id text,
  name text not null check (char_length(trim(name)) between 1 and 60),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, week_id)
);

create unique index idx_schedule_teams_external
  on public.schedule_teams (week_id, external_group_id)
  where external_group_id is not null;
create unique index idx_schedule_teams_default
  on public.schedule_teams (week_id)
  where is_default;

-- 时段定义
create table public.time_slots (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references public.schedule_weeks(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 30),
  start_time time not null,
  end_time time not null,
  sort_order integer not null default 0,
  is_selectable boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 骑手表
create table public.riders (
  rider_id text not null,
  week_id uuid not null references public.schedule_weeks(id) on delete cascade,
  team_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 20),
  rider_type text not null default '',
  rest_preference_mode text check (rest_preference_mode in ('random', 'specified')),
  preference_submitted_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (rider_id, week_id),
  foreign key (team_id, week_id) references public.schedule_teams(id, week_id) on delete cascade
);

-- 每日排休名额
create table public.rest_day_limits (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references public.schedule_weeks(id) on delete cascade,
  team_id uuid not null,
  rest_date date not null,
  max_slots integer not null check (max_slots >= 0 and max_slots <= 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (week_id, team_id, rest_date),
  foreign key (team_id, week_id) references public.schedule_teams(id, week_id) on delete cascade
);

-- 骑手排班明细
-- slot_id is null => 该骑手当天排休
-- slot_id is not null => is_selected 标记该时段是否出勤
create table public.rider_schedules (
  id uuid primary key default gen_random_uuid(),
  rider_id text not null,
  week_id uuid not null references public.schedule_weeks(id) on delete cascade,
  work_date date not null,
  slot_id uuid references public.time_slots(id) on delete cascade,
  is_selected boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rider_id, week_id, work_date, slot_id),
  foreign key (rider_id, week_id) references public.riders(rider_id, week_id) on delete cascade
);

-- XLS 导入快照（用于导出原始模板）
create table public.week_import_snapshots (
  week_id uuid primary key references public.schedule_weeks(id) on delete cascade,
  header jsonb not null,
  rows jsonb not null,
  base_columns integer not null,
  slot_labels jsonb not null,
  slot_indexes jsonb not null,
  created_at timestamptz not null default now()
);

-- ==================== 4. 索引 ====================

-- 每个骑手每周最多一条排休记录
create unique index idx_rs_rest on public.rider_schedules (rider_id, week_id) where slot_id is null;

-- 每个骑手每天每时段最多一条记录
create unique index idx_rs_slot on public.rider_schedules (rider_id, week_id, work_date, slot_id) where slot_id is not null;

create index idx_rs_week on public.rider_schedules (week_id);
create index idx_rs_rider_week on public.rider_schedules (rider_id, week_id);
create index idx_rs_work_date on public.rider_schedules (work_date);
create index idx_ts_week on public.time_slots (week_id, sort_order);
create index idx_riders_week on public.riders (week_id, team_id);
create index idx_rdl_week on public.rest_day_limits (week_id, team_id);
create index idx_sw_active on public.schedule_weeks (is_active, start_date desc);

-- ==================== 5. 函数 ====================

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.ensure_default_team(p_week_id uuid)
returns uuid language plpgsql
as $$
declare
  v_team_id uuid;
begin
  select id into v_team_id
  from public.schedule_teams
  where week_id = p_week_id and is_default
  limit 1;

  if v_team_id is null then
    insert into public.schedule_teams (week_id, name, is_default)
    values (p_week_id, '默认小队', true)
    on conflict (week_id) where is_default do update set name = excluded.name
    returning id into v_team_id;
  end if;

  return v_team_id;
end;
$$;

create or replace function public.create_default_team_for_week()
returns trigger language plpgsql
as $$
begin
  perform public.ensure_default_team(new.id);
  return new;
end;
$$;

-- 批量导入 XLS 数据（事务内完成）
-- 会重置该周的时段、排班记录，并保存原始导入快照
-- p_data jsonb 格式：
-- {
--   "weekStart": "2026-06-01",
--   "weekEnd": "2026-06-07",
--   "slots": [{"name":"午高峰","startTime":"10:30","endTime":"13:30","sortOrder":1}, ...],
--   "entries": [
--     {"riderId":"4598058","riderName":"龚传仓","date":"20260601","selections":[1,0,0,0,0,0]},
--     ...
--   ],
--   "teams": [{"externalGroupId":"320965","name":"核心1队"}],
--   "riderTeams": [{"riderId":"4598058","riderName":"龚传仓","externalGroupId":"320965","groupName":"核心1队"}]
-- }
create or replace function public.import_xls_week(p_week_id uuid, p_data jsonb)
returns jsonb language plpgsql
as $$
declare
  v_slot jsonb;
  v_entry jsonb;
  v_team jsonb;
  v_rider_id text;
  v_rider_name text;
  v_team_id uuid;
  v_has_team_data boolean;
  v_slot_ids uuid[];
  v_slot_idx integer;
  v_selection integer;
  v_work_date date;
  v_limit_template jsonb := '{}'::jsonb;
  v_team_limit_templates jsonb := '{}'::jsonb;
  v_day date;
  v_week_start date;
  v_week_end date;
  v_team_rec record;
  v_limit integer;
begin
  if not exists (select 1 from public.schedule_weeks where id = p_week_id) then
    raise exception '排班周不存在';
  end if;

  if not exists (
    select 1
    from public.schedule_weeks
    where id = p_week_id
      and start_date = (p_data->>'weekStart')::date
      and end_date = (p_data->>'weekEnd')::date
  ) then
    raise exception '文件日期范围与当前排班周不一致';
  end if;

  v_has_team_data := coalesce(jsonb_array_length(p_data->'riderTeams'), 0) > 0;

  if v_has_team_data then
    if (
      select count(*) <> count(distinct item->>'riderId')
      from jsonb_array_elements(p_data->'riderTeams') item
    ) then
      raise exception '小队数据存在重复骑手ID';
    end if;

    if exists (
      select 1
      from (
        select distinct item->>'riderId' as rider_id
        from jsonb_array_elements(p_data->'entries') item
      ) preference
      full join (
        select item->>'riderId' as rider_id
        from jsonb_array_elements(p_data->'riderTeams') item
      ) team using (rider_id)
      where preference.rider_id is null or team.rider_id is null
    ) then
      raise exception '两份文档的骑手名单不一致';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(p_data->'riderTeams') team
      join (
        select distinct on (item->>'riderId')
          item->>'riderId' as rider_id,
          item->>'riderName' as rider_name
        from jsonb_array_elements(p_data->'entries') item
      ) preference on preference.rider_id = team->>'riderId'
      where regexp_replace(preference.rider_name, '\s+', '', 'g')
        <> regexp_replace(team->>'riderName', '\s+', '', 'g')
    ) then
      raise exception '两份文档存在骑手姓名不一致';
    end if;
  end if;

  select coalesce(jsonb_object_agg(to_char(rdl.rest_date, 'YYYY-MM-DD'), rdl.max_slots), '{}'::jsonb)
  into v_limit_template
  from public.rest_day_limits rdl
  join public.schedule_teams st on st.id = rdl.team_id
  where rdl.week_id = p_week_id and st.is_default;

  select coalesce(
    jsonb_object_agg(
      coalesce(st.external_group_id, '__default__') || '|' || to_char(rdl.rest_date, 'YYYY-MM-DD'),
      rdl.max_slots
    ),
    '{}'::jsonb
  )
  into v_team_limit_templates
  from public.rest_day_limits rdl
  join public.schedule_teams st on st.id = rdl.team_id
  where rdl.week_id = p_week_id;

  select start_date, end_date into v_week_start, v_week_end
  from public.schedule_weeks where id = p_week_id;

  delete from public.week_import_snapshots where week_id = p_week_id;
  delete from public.rider_schedules where week_id = p_week_id;
  delete from public.time_slots where week_id = p_week_id;
  delete from public.rest_day_limits where week_id = p_week_id;
  delete from public.riders where week_id = p_week_id;
  delete from public.schedule_teams where week_id = p_week_id;

  if v_has_team_data then
    for v_team in select * from jsonb_array_elements(p_data->'teams')
    loop
      insert into public.schedule_teams (week_id, external_group_id, name, is_default)
      values (
        p_week_id,
        nullif(btrim(v_team->>'externalGroupId'), ''),
        btrim(v_team->>'name'),
        false
      );
    end loop;
  else
    v_team_id := public.ensure_default_team(p_week_id);
  end if;

  for v_team_rec in
    select id, external_group_id from public.schedule_teams where week_id = p_week_id
  loop
    v_day := v_week_start;
    while v_day <= v_week_end loop
      v_limit := coalesce(
        (
          v_team_limit_templates
          ->>(coalesce(v_team_rec.external_group_id, '__default__') || '|' || to_char(v_day, 'YYYY-MM-DD'))
        )::integer,
        (v_limit_template->>to_char(v_day, 'YYYY-MM-DD'))::integer,
        case when extract(dow from v_day) in (0, 6) then 2 else 5 end
      );
      insert into public.rest_day_limits (week_id, team_id, rest_date, max_slots)
      values (p_week_id, v_team_rec.id, v_day, v_limit);
      v_day := v_day + 1;
    end loop;
  end loop;

  for v_slot in select * from jsonb_array_elements(p_data->'slots')
  loop
    insert into public.time_slots (week_id, name, start_time, end_time, sort_order, is_selectable)
    values (
      p_week_id,
      v_slot->>'name',
      (v_slot->>'startTime')::time,
      (v_slot->>'endTime')::time,
      (v_slot->>'sortOrder')::int,
      true
    );
  end loop;

  select array_agg(id order by sort_order) into v_slot_ids
  from public.time_slots where week_id = p_week_id;

  -- 导入骑手名单，并根据原始 0/1 填充初始排班
  for v_entry in select * from jsonb_array_elements(p_data->'entries')
  loop
    v_rider_id := v_entry->>'riderId';
    v_rider_name := v_entry->>'riderName';

    if v_rider_id is not null and v_rider_name is not null then
      if v_has_team_data then
        select st.id into v_team_id
        from jsonb_array_elements(p_data->'riderTeams') assignment
        join public.schedule_teams st
          on st.week_id = p_week_id
         and st.external_group_id = assignment->>'externalGroupId'
        where assignment->>'riderId' = v_rider_id
        limit 1;
      end if;

      if v_team_id is null then
        raise exception '骑手 % 未找到所属小队', v_rider_id;
      end if;

      insert into public.riders (rider_id, week_id, team_id, name)
      values (v_rider_id, p_week_id, v_team_id, v_rider_name)
      on conflict (rider_id, week_id) do update set
        name = v_rider_name,
        team_id = v_team_id;

      if v_slot_ids is not null and coalesce(v_entry->>'date', '') ~ '^\d{8}$' then
        v_work_date := to_date(v_entry->>'date', 'YYYYMMDD');
        if v_work_date is not null then
          for v_slot_idx in 1..coalesce(array_length(v_slot_ids, 1), 0)
          loop
            v_selection := coalesce((v_entry->'selections'->>(v_slot_idx - 1)), '0')::int;
            if v_selection = 1 then
              insert into public.rider_schedules (rider_id, week_id, work_date, slot_id, is_selected)
              values (v_rider_id, p_week_id, v_work_date, v_slot_ids[v_slot_idx], true)
              on conflict (rider_id, week_id, work_date, slot_id) where slot_id is not null
              do update set is_selected = true;
            end if;
          end loop;
        end if;
      end if;
    end if;
  end loop;

  if coalesce(jsonb_array_length(p_data->'snapshot'->'header'), 0) > 0 then
    insert into public.week_import_snapshots (week_id, header, rows, base_columns, slot_labels, slot_indexes)
    values (
      p_week_id,
      coalesce(p_data->'snapshot'->'header', '[]'::jsonb),
      coalesce(p_data->'snapshot'->'rows', '[]'::jsonb),
      coalesce((p_data->>'baseColumnCount')::int, 6),
      coalesce(p_data->'slotLabels', '[]'::jsonb),
      coalesce(p_data->'slotColumnIndexes', '[]'::jsonb)
    )
    on conflict (week_id) do update set
      header = excluded.header,
      rows = excluded.rows,
      base_columns = excluded.base_columns,
      slot_labels = excluded.slot_labels,
      slot_indexes = excluded.slot_indexes,
      created_at = now();
  end if;

  return jsonb_build_object(
    'success', true,
    'message', '导入完成（已更新骑手名单、小队、时段与初始选择）',
    'teamCount', (select count(*) from public.schedule_teams where week_id = p_week_id),
    'riderCount', (select count(*) from public.riders where week_id = p_week_id)
  );
end;
$$;

-- 将 XLS 快照中的日期文本统一为 YYYYMMDD，用于与 rider_schedules 匹配
create or replace function public.normalize_map_date_key(p_text text)
returns text language plpgsql immutable
as $$
declare
  v_clean text;
  v_date date;
begin
  if p_text is null or btrim(p_text) = '' then
    return '';
  end if;

  v_clean := btrim(p_text);
  if v_clean ~ '^\d{8}$' then
    return v_clean;
  end if;

  begin
    v_date := v_clean::date;
    return to_char(v_date, 'YYYYMMDD');
  exception when others then
    null;
  end;

  v_clean := regexp_replace(v_clean, '[^0-9]', '', 'g');
  if length(v_clean) = 8 then
    return v_clean;
  end if;

  -- Excel 日期序列号（如 45809）
  if v_clean ~ '^\d{4,6}$' then
    begin
      v_date := date '1899-12-30' + v_clean::int;
      return to_char(v_date, 'YYYYMMDD');
    exception when others then
      null;
    end;
  end if;

  return btrim(p_text);
end;
$$;

create or replace function public.export_xls_week(p_week_id uuid)
returns jsonb language plpgsql
as $$
declare
  v_snapshot record;
  header_text text[];
  slot_labels text[];
  slot_col_positions int[];
  base_columns integer;
  header_len integer;
  slot_count integer;
  result_rows jsonb := '[]'::jsonb;
  row_json jsonb;
  cell record;
  arr text[];
  rider_col integer;
  date_col integer;
  rider_id text;
  date_key text;
  slot_json jsonb;
  selection_map jsonb := '{}'::jsonb;
  map_key text;
  idx integer;
  col_index integer;
  v_slot_ids uuid[];
  fallback boolean := false;
  start_date date;
  end_date date;
  cur_date date;
  rider_rec record;
begin
  select array_agg(ts.id order by ts.sort_order) into v_slot_ids
  from public.time_slots ts where ts.week_id = p_week_id;

  select jsonb_object_agg(key, value) into selection_map
  from (
    select btrim(rs.rider_id) || '_' || to_char(rs.work_date, 'YYYYMMDD') as key,
           jsonb_object_agg(array_idx::text, to_jsonb((rs.is_selected is true)::int)) as value
    from (
      select rs.rider_id, rs.work_date, rs.is_selected, rs.slot_id,
             array_position(v_slot_ids, rs.slot_id) as array_idx
      from public.rider_schedules rs
      join public.time_slots ts on ts.id = rs.slot_id
      where rs.week_id = p_week_id
        and rs.slot_id is not null
        and array_position(v_slot_ids, rs.slot_id) is not null
    ) rs
    group by rs.rider_id, rs.work_date
  ) s;
  if selection_map is null then
    selection_map := '{}'::jsonb;
  end if;

  select * into v_snapshot from public.week_import_snapshots where week_id = p_week_id;

  if v_snapshot is null then
    fallback := true;
    select start_date, end_date into start_date, end_date
    from public.schedule_weeks where id = p_week_id;

    header_text := ARRAY['管理组ID', '管理组名称', '骑手ID', '骑手姓名', '日期', '骑手类型'];
    base_columns := array_length(header_text, 1);

    slot_labels := ARRAY[]::text[];
    if v_slot_ids is not null then
      select array_agg(ts.name || '|' || to_char(ts.start_time, 'HH24:MI') || '-' || to_char(ts.end_time, 'HH24:MI')
             order by ts.sort_order)
      into slot_labels
      from public.time_slots ts
      where ts.week_id = p_week_id;
    end if;

    slot_count := coalesce(array_length(slot_labels, 1), 0);
    slot_col_positions := ARRAY(SELECT base_columns + i - 1 FROM generate_series(1, slot_count) g(i));
    header_text := header_text || slot_labels;
    header_len := array_length(header_text, 1);
    rider_col := 3;
    date_col := 5;

    if start_date is null or end_date is null then
      return jsonb_build_object(
        'header', to_jsonb(header_text),
        'rows', '[]'::jsonb,
        'slotLabels', to_jsonb(slot_labels),
        'slotColumnIndexes', to_jsonb(slot_col_positions),
        'dateColumnIndex', date_col - 1,
        'baseColumns', base_columns,
        'generated', true
      );
    end if;

    for rider_rec in
      select r.rider_id, r.name,
             coalesce(st.external_group_id, '') as group_id,
             st.name as group_name,
             r.rider_type
      from public.riders r
      join public.schedule_teams st on st.id = r.team_id
      where r.week_id = p_week_id
      order by st.name, r.name
    loop
      cur_date := start_date;

      while cur_date <= end_date loop
        arr := array_fill(''::text, ARRAY[header_len]);
        arr[1] := coalesce(rider_rec.group_id, '');
        arr[2] := coalesce(rider_rec.group_name, '');
        arr[3] := coalesce(rider_rec.rider_id, '');
        arr[4] := coalesce(rider_rec.name, '');
        arr[5] := to_char(cur_date, 'YYYYMMDD');
        arr[6] := coalesce(rider_rec.rider_type, '');
        map_key := btrim(coalesce(rider_rec.rider_id, '')) || '_' || to_char(cur_date, 'YYYYMMDD');
        slot_json := coalesce(selection_map -> map_key, '{}'::jsonb);
        for idx in 1..slot_count loop
          arr[base_columns + idx] := coalesce(slot_json->>(idx::text), '0');
        end loop;
        result_rows := result_rows || jsonb_build_array(to_jsonb(arr));
        cur_date := cur_date + interval '1 day';
      end loop;
    end loop;

    return jsonb_build_object(
      'header', to_jsonb(header_text),
      'rows', result_rows,
      'slotLabels', to_jsonb(slot_labels),
      'slotColumnIndexes', to_jsonb(slot_col_positions),
      'dateColumnIndex', date_col - 1,
      'baseColumns', base_columns,
      'generated', true
    );
  end if;

  select array_agg(value order by ord) into header_text
  from jsonb_array_elements_text(v_snapshot.header) with ordinality as t(value, ord);
  select array_agg((value)::int order by ord) into slot_col_positions
  from jsonb_array_elements_text(v_snapshot.slot_indexes) with ordinality as t(value, ord);
  select array_agg(value order by ord) into slot_labels
  from jsonb_array_elements_text(v_snapshot.slot_labels) with ordinality as t(value, ord);

  base_columns := coalesce(v_snapshot.base_columns, 6);
  header_len := coalesce(array_length(header_text, 1), 0);
  slot_count := coalesce(array_length(slot_col_positions, 1), 0);

  if slot_count = 0 and v_slot_ids is not null then
    slot_count := coalesce(array_length(v_slot_ids, 1), 0);
    slot_col_positions := ARRAY(
      SELECT base_columns + i - 1 FROM generate_series(1, slot_count) g(i)
    );
  end if;

  rider_col := coalesce(array_position(header_text, '骑手ID'), 3);
  date_col := coalesce(array_position(header_text, '日期'), 5);

  for row_json in select value from jsonb_array_elements(v_snapshot.rows)
  loop
    arr := array_fill(''::text, ARRAY[header_len]);
    for cell in select value, ord from jsonb_array_elements_text(row_json) with ordinality as t(value, ord)
    loop
      if cell.ord <= header_len then
        arr[cell.ord] = cell.value;
      end if;
    end loop;

    rider_id := btrim(coalesce(arr[rider_col], ''));
    date_key := public.normalize_map_date_key(arr[date_col]);
    map_key := rider_id || '_' || date_key;
    slot_json := coalesce(selection_map -> map_key, '{}'::jsonb);

    for idx in 1..slot_count loop
      col_index := slot_col_positions[idx] + 1;
      if col_index between 1 and header_len then
        arr[col_index] := coalesce(slot_json->>(idx::text), '0');
      end if;
    end loop;

    result_rows := result_rows || jsonb_build_array(to_jsonb(arr));
  end loop;

  return jsonb_build_object(
    'header', to_jsonb(header_text),
    'rows', result_rows,
    'slotLabels', to_jsonb(slot_labels),
    'slotColumnIndexes', to_jsonb(slot_col_positions),
    'dateColumnIndex', date_col - 1,
    'baseColumns', base_columns,
    'generated', false
  );
end;
$$;

-- 清空某周所有排班（保留时段和骑手）
create or replace function public.clear_week_schedules(p_week_id uuid)
returns jsonb language plpgsql
as $$
begin
  delete from public.rider_schedules where week_id = p_week_id;
  return jsonb_build_object('success', true, 'message', '已清空');
end;
$$;

-- 获取周的所有骑手（含排班统计）
create or replace function public.get_week_riders(p_week_id uuid)
returns jsonb language plpgsql
as $$
declare
  v_result jsonb;
  v_required_slots int;
begin
  select required_slots into v_required_slots from public.schedule_weeks where id = p_week_id;

  select jsonb_agg(jsonb_build_object(
    'riderId', r.rider_id,
    'name', r.name,
    'teamId', r.team_id,
    'groupId', coalesce(st.external_group_id, ''),
    'groupName', st.name,
    'requiredSlots', v_required_slots
  ) order by st.name, r.name)
  into v_result
  from public.riders r
  join public.schedule_teams st on st.id = r.team_id
  where r.week_id = p_week_id;
  return coalesce(v_result, '[]'::jsonb);
end;
$$;

-- 获取周的所有时段
create or replace function public.get_week_slots(p_week_id uuid)
returns jsonb language plpgsql
as $$
declare
  v_result jsonb;
begin
  select jsonb_agg(jsonb_build_object(
    'id', ts.id,
    'name', ts.name,
    'startTime', ts.start_time,
    'endTime', ts.end_time,
    'sortOrder', ts.sort_order,
    'isSelectable', ts.is_selectable
  ) order by ts.sort_order)
  into v_result
  from public.time_slots ts
  where ts.week_id = p_week_id and ts.is_active = true;
  return coalesce(v_result, '[]'::jsonb);
end;
$$;

-- 管理员切换时段可选状态
create or replace function public.toggle_slot_selectable(p_slot_id uuid)
returns jsonb language plpgsql
as $$
declare
  v_new boolean;
begin
  update public.time_slots
  set is_selectable = not is_selectable
  where id = p_slot_id
  returning is_selectable into v_new;
  return jsonb_build_object('success', true, 'isSelectable', v_new);
end;
$$;

-- 管理员设置每周必须选时段数
create or replace function public.set_week_required_slots(p_week_id uuid, p_required_slots int)
returns jsonb language plpgsql
as $$
begin
  update public.schedule_weeks set required_slots = p_required_slots where id = p_week_id;
  return jsonb_build_object('success', true);
end;
$$;

-- 管理员设置默认时段
create or replace function public.set_week_default_slots(p_week_id uuid, p_default_slot_ids uuid[])
returns jsonb language plpgsql
as $$
begin
  update public.schedule_weeks set default_slot_ids = p_default_slot_ids where id = p_week_id;
  return jsonb_build_object('success', true);
end;
$$;

-- 骑手切换时段（单时段模式：原子性地取消旧的并选择新的）
create or replace function public.switch_rider_slot(
  p_rider_id text,
  p_week_id uuid,
  p_work_date date,
  p_old_slot_id uuid,
  p_new_slot_id uuid
)
returns jsonb language plpgsql
as $$
declare
  v_new_slot_selectable boolean;
begin
  -- 检查新时段是否可选
  select is_selectable into v_new_slot_selectable
  from public.time_slots where id = p_new_slot_id;

  if not v_new_slot_selectable then
    return jsonb_build_object('success', false, 'message', '该时段不可选');
  end if;

  -- 如果当天有排休记录，先删除
  delete from public.rider_schedules
  where week_id = p_week_id and rider_id = p_rider_id and work_date = p_work_date and slot_id is null;

  -- 删除旧时段
  delete from public.rider_schedules
  where week_id = p_week_id and rider_id = p_rider_id and work_date = p_work_date and slot_id = p_old_slot_id;

  -- 选择新时段
  insert into public.rider_schedules (rider_id, week_id, work_date, slot_id, is_selected)
  values (p_rider_id, p_week_id, p_work_date, p_new_slot_id, true)
  on conflict (rider_id, week_id, work_date, slot_id) where slot_id is not null
  do update set is_selected = true;

  return jsonb_build_object('success', true, 'selected', true);
end;
$$;

-- 批量设置排休
create or replace function public.bulk_set_rider_rest(
  p_week_id uuid,
  p_rider_ids text[],
  p_work_date date
)
returns jsonb language plpgsql
as $$
declare
  v_team_id uuid;
  v_limit integer;
  v_used integer;
  v_applied integer := 0;
  v_failed text[] := array[]::text[];
  v_rider text;
  v_existing_rest_date date;
begin
  if p_rider_ids is null or array_length(p_rider_ids, 1) is null then
    return jsonb_build_object('success', false, 'message', '未提供骑手名单');
  end if;

  if not exists(select 1 from public.schedule_weeks where id = p_week_id) then
    return jsonb_build_object('success', false, 'message', '排班周不存在');
  end if;

  for v_rider in select unnest(p_rider_ids)
  loop
    select team_id into v_team_id
    from public.riders
    where week_id = p_week_id and rider_id = v_rider;

    if v_team_id is null then
      v_failed := array_append(v_failed, v_rider);
      continue;
    end if;

    select work_date into v_existing_rest_date
    from public.rider_schedules
    where week_id = p_week_id and rider_id = v_rider and slot_id is null
    limit 1;

    if v_existing_rest_date = p_work_date then
      continue;
    end if;
    if v_existing_rest_date is not null then
      v_failed := array_append(v_failed, v_rider);
      continue;
    end if;

    select max_slots into v_limit
    from public.rest_day_limits
    where week_id = p_week_id and team_id = v_team_id and rest_date = p_work_date;

    if v_limit is null then
      v_limit := public.ensure_default_day_limit(p_week_id, v_team_id, p_work_date);
    end if;
    select max_slots into v_limit
    from public.rest_day_limits
    where week_id = p_week_id and team_id = v_team_id and rest_date = p_work_date
    for update;

    select count(*) into v_used
    from public.rider_schedules rs
    join public.riders r
      on r.week_id = rs.week_id and r.rider_id = rs.rider_id
    where rs.week_id = p_week_id
      and r.team_id = v_team_id
      and rs.work_date = p_work_date
      and rs.slot_id is null;

    if v_used >= v_limit then
      v_failed := array_append(v_failed, v_rider);
      continue;
    end if;

    -- 删除当日所有出勤
    delete from public.rider_schedules
    where week_id = p_week_id and rider_id = v_rider and work_date = p_work_date and slot_id is not null;

    insert into public.rider_schedules (rider_id, week_id, work_date, slot_id, is_selected)
    values (v_rider, p_week_id, p_work_date, null, null)
    on conflict (rider_id, week_id) where slot_id is null do nothing;

    v_used := v_used + 1;
    v_applied := v_applied + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'processed', v_applied,
    'failed', v_failed
  );
end;
$$;

-- 批量取消排休（若未指定日期则清除整周排休）
create or replace function public.bulk_clear_rider_rest(
  p_week_id uuid,
  p_rider_ids text[],
  p_work_date date default null
)
returns jsonb language plpgsql
as $$
declare
  v_removed integer := 0;
begin
  if p_rider_ids is null or array_length(p_rider_ids, 1) is null then
    return jsonb_build_object('success', false, 'message', '未提供骑手名单');
  end if;

  if p_work_date is null then
    delete from public.rider_schedules
    where week_id = p_week_id
      and rider_id = any(p_rider_ids)
      and slot_id is null;
    get diagnostics v_removed = row_count;
  else
    delete from public.rider_schedules
    where week_id = p_week_id
      and rider_id = any(p_rider_ids)
      and work_date = p_work_date
      and slot_id is null;
    get diagnostics v_removed = row_count;
  end if;

  return jsonb_build_object('success', true, 'removed', v_removed);
end;
$$;

-- 批量套用默认时段
create or replace function public.bulk_apply_default_slots(
  p_week_id uuid,
  p_rider_ids text[]
)
returns jsonb language plpgsql
as $$
declare
  v_defaults uuid[];
  v_start date;
  v_end date;
  v_day date;
  v_rider text;
  v_slot uuid;
  v_processed integer := 0;
begin
  select default_slot_ids, start_date, end_date
  into v_defaults, v_start, v_end
  from public.schedule_weeks
  where id = p_week_id;

  if v_defaults is null or array_length(v_defaults, 1) is null then
    return jsonb_build_object('success', false, 'message', '当前周未配置默认时段');
  end if;

  if p_rider_ids is null or array_length(p_rider_ids, 1) is null then
    return jsonb_build_object('success', false, 'message', '未提供骑手名单');
  end if;

  for v_rider in select unnest(p_rider_ids)
  loop
    v_day := v_start;
    while v_day <= v_end loop
      -- 清除当天所有记录（排休+出勤）
      delete from public.rider_schedules
      where week_id = p_week_id and rider_id = v_rider and work_date = v_day;

      -- 插入默认时段
      foreach v_slot in array v_defaults
      loop
        insert into public.rider_schedules (rider_id, week_id, work_date, slot_id, is_selected)
        values (v_rider, p_week_id, v_day, v_slot, true)
        on conflict (rider_id, week_id, work_date, slot_id) where slot_id is not null
        do update set is_selected = true;
      end loop;

      v_day := v_day + interval '1 day';
    end loop;
    v_processed := v_processed + 1;
  end loop;

  return jsonb_build_object('success', true, 'processed', v_processed);
end;
$$;

-- 一键完成：分配缺失排休，并用默认时段补足每天要求的出勤时段数
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

  -- 再补时段：保留已有选择，只从默认时段中补到每天规定数量。
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
        and ts.is_active
        and ts.is_selectable;

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

-- 批量套用指定时段（跳过排休日）
create or replace function public.bulk_apply_slot(
  p_week_id uuid,
  p_rider_ids text[],
  p_slot_id uuid
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
begin
  select start_date, end_date into v_start, v_end
  from public.schedule_weeks where id = p_week_id;

  if p_rider_ids is null or array_length(p_rider_ids, 1) is null then
    return jsonb_build_object('success', false, 'message', '未提供骑手名单');
  end if;

  for v_rider in select unnest(p_rider_ids)
  loop
    v_day := v_start;
    while v_day <= v_end loop
      select exists(
        select 1 from public.rider_schedules
        where week_id = p_week_id and rider_id = v_rider and work_date = v_day and slot_id is null
      ) into v_has_rest;

      if v_has_rest then
        v_skipped := v_skipped + 1;
      else
        insert into public.rider_schedules (rider_id, week_id, work_date, slot_id, is_selected)
        values (v_rider, p_week_id, v_day, p_slot_id, true)
        on conflict (rider_id, week_id, work_date, slot_id) where slot_id is not null
        do update set is_selected = true;
        v_processed := v_processed + 1;
      end if;

      v_day := v_day + interval '1 day';
    end loop;
  end loop;

  return jsonb_build_object('success', true, 'processed', v_processed, 'skipped', v_skipped);
end;
$$;

-- 批量清空骑手当周排班
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

  delete from public.rider_schedules
  where week_id = p_week_id
    and rider_id = any(p_rider_ids);
  get diagnostics v_removed = row_count;

  return jsonb_build_object('success', true, 'removed', v_removed);
end;
$$;

-- 骑手切换时段出勤状态
create or replace function public.toggle_rider_slot(
  p_rider_id text,
  p_week_id uuid,
  p_work_date date,
  p_slot_id uuid
)
returns jsonb language plpgsql
as $$
declare
  v_current boolean;
  v_slot_selectable boolean;
  v_required_slots int;
  v_current_selected_count int;
begin
  -- 检查时段是否可选
  select is_selectable into v_slot_selectable
  from public.time_slots where id = p_slot_id;

  if not v_slot_selectable then
    return jsonb_build_object('success', false, 'message', '该时段不可选');
  end if;

  -- 获取该周必须选时段数
  select required_slots into v_required_slots
  from public.schedule_weeks where id = p_week_id;

  -- 如果当天有排休记录，先删除
  delete from public.rider_schedules
  where week_id = p_week_id and rider_id = p_rider_id and work_date = p_work_date and slot_id is null;

  -- 获取当前状态
  select is_selected into v_current
  from public.rider_schedules
  where week_id = p_week_id and rider_id = p_rider_id and work_date = p_work_date and slot_id = p_slot_id;

  if v_current is true then
    -- 取消选择
    delete from public.rider_schedules
    where week_id = p_week_id and rider_id = p_rider_id and work_date = p_work_date and slot_id = p_slot_id;
    return jsonb_build_object('success', true, 'selected', false);
  else
    -- 选择前检查是否已达到上限
    if v_required_slots > 0 then
      select count(*) into v_current_selected_count
      from public.rider_schedules
      where week_id = p_week_id and rider_id = p_rider_id and work_date = p_work_date and slot_id is not null and is_selected = true;

      if v_current_selected_count >= v_required_slots then
        return jsonb_build_object('success', false, 'message', '每天只能选择 ' || v_required_slots || ' 个时段');
      end if;
    end if;

    -- 选择
    insert into public.rider_schedules (rider_id, week_id, work_date, slot_id, is_selected)
    values (p_rider_id, p_week_id, p_work_date, p_slot_id, true)
    on conflict (rider_id, week_id, work_date, slot_id) where slot_id is not null
    do update set is_selected = true;
    return jsonb_build_object('success', true, 'selected', true);
  end if;
end;
$$;

-- 骑手设为排休
create or replace function public.set_rider_rest(
  p_rider_id text,
  p_week_id uuid,
  p_work_date date
)
returns jsonb language plpgsql
as $$
declare
  v_team_id uuid;
  v_limit integer;
  v_used integer;
  v_existing_rest_date date;
begin
  select team_id into v_team_id
  from public.riders
  where week_id = p_week_id and rider_id = p_rider_id;

  if v_team_id is null then
    return jsonb_build_object('success', false, 'message', '骑手不在当前排班周');
  end if;

  select work_date into v_existing_rest_date
  from public.rider_schedules
  where week_id = p_week_id and rider_id = p_rider_id and slot_id is null
  limit 1;

  if v_existing_rest_date = p_work_date then
    return jsonb_build_object('success', true, 'message', '已设为排休');
  end if;
  if v_existing_rest_date is not null then
    return jsonb_build_object('success', false, 'message', '每周只能选择一天排休，请先取消原排休');
  end if;

  -- 检查排休名额
  select max_slots into v_limit
  from public.rest_day_limits
  where week_id = p_week_id and team_id = v_team_id and rest_date = p_work_date;

  if v_limit is null then
    v_limit := public.ensure_default_day_limit(p_week_id, v_team_id, p_work_date);
  end if;
  select max_slots into v_limit
  from public.rest_day_limits
  where week_id = p_week_id and team_id = v_team_id and rest_date = p_work_date
  for update;

  select count(*) into v_used
  from public.rider_schedules rs
  join public.riders r
    on r.week_id = rs.week_id and r.rider_id = rs.rider_id
  where rs.week_id = p_week_id
    and r.team_id = v_team_id
    and rs.work_date = p_work_date
    and rs.slot_id is null;

  if v_used >= v_limit then
    return jsonb_build_object('success', false, 'message', '该日期排休名额已满');
  end if;

  -- 删除该骑手当天的所有时段选择
  delete from public.rider_schedules
  where week_id = p_week_id and rider_id = p_rider_id and work_date = p_work_date and slot_id is not null;

  -- 插入排休记录
  insert into public.rider_schedules (rider_id, week_id, work_date, slot_id, is_selected)
  values (p_rider_id, p_week_id, p_work_date, null, null)
  on conflict (rider_id, week_id) where slot_id is null do nothing;

  return jsonb_build_object('success', true, 'message', '已设为排休');
end;
$$;

-- 员工选择随机排休：保存统一出勤时段，但不占用任何具体排休日期名额
create or replace function public.choose_random_rest_preference(
  p_rider_id text,
  p_week_id uuid,
  p_slot_ids uuid[]
)
returns jsonb language plpgsql
as $$
declare
  v_mode text;
  v_required_slots integer;
  v_week_start date;
  v_week_end date;
  v_valid_slot_count integer;
  v_day date;
  v_slot_id uuid;
begin
  select r.rest_preference_mode, sw.required_slots, sw.start_date, sw.end_date
  into v_mode, v_required_slots, v_week_start, v_week_end
  from public.riders r
  join public.schedule_weeks sw on sw.id = r.week_id
  where r.week_id = p_week_id and r.rider_id = p_rider_id
  for update of r;

  if not found then
    return jsonb_build_object('success', false, 'message', '骑手不在当前排班周');
  end if;

  if v_mode = 'specified' then
    return jsonb_build_object('success', false, 'message', '已提交指定排休，不能改为随机排休');
  end if;

  if v_mode = 'random' then
    return jsonb_build_object('success', true, 'mode', 'random');
  end if;

  if coalesce(array_length(p_slot_ids, 1), 0) <> v_required_slots then
    return jsonb_build_object('success', false, 'message', '请选择 ' || v_required_slots || ' 个统一出勤时段');
  end if;

  select count(distinct ts.id) into v_valid_slot_count
  from public.time_slots ts
  where ts.week_id = p_week_id
    and ts.is_active
    and ts.is_selectable
    and ts.id = any(coalesce(p_slot_ids, array[]::uuid[]));

  if v_valid_slot_count <> v_required_slots then
    return jsonb_build_object('success', false, 'message', '出勤时段无效或存在重复');
  end if;

  -- 随机的是休息日期，出勤时段仍然先统一写入整周。
  delete from public.rider_schedules
  where week_id = p_week_id and rider_id = p_rider_id;

  v_day := v_week_start;
  while v_day <= v_week_end loop
    foreach v_slot_id in array coalesce(p_slot_ids, array[]::uuid[])
    loop
      insert into public.rider_schedules (rider_id, week_id, work_date, slot_id, is_selected)
      values (p_rider_id, p_week_id, v_day, v_slot_id, true);
    end loop;
    v_day := v_day + 1;
  end loop;

  update public.riders
  set rest_preference_mode = 'random',
      preference_submitted_at = now()
  where week_id = p_week_id and rider_id = p_rider_id;

  return jsonb_build_object('success', true, 'mode', 'random');
end;
$$;

-- 员工指定排休并一次性套用整周统一出勤时段
create or replace function public.submit_specified_schedule(
  p_rider_id text,
  p_week_id uuid,
  p_rest_date date,
  p_slot_ids uuid[]
)
returns jsonb language plpgsql
as $$
declare
  v_team_id uuid;
  v_mode text;
  v_required_slots integer;
  v_week_start date;
  v_week_end date;
  v_limit integer;
  v_used integer;
  v_day date;
  v_slot_id uuid;
  v_valid_slot_count integer;
begin
  select r.team_id, r.rest_preference_mode, sw.required_slots, sw.start_date, sw.end_date
  into v_team_id, v_mode, v_required_slots, v_week_start, v_week_end
  from public.riders r
  join public.schedule_weeks sw on sw.id = r.week_id
  where r.week_id = p_week_id and r.rider_id = p_rider_id
  for update of r;

  if not found then
    return jsonb_build_object('success', false, 'message', '骑手不在当前排班周');
  end if;

  if v_mode = 'random' then
    return jsonb_build_object('success', false, 'message', '已选择随机排休，不能指定排休');
  end if;

  if p_rest_date < v_week_start or p_rest_date > v_week_end then
    return jsonb_build_object('success', false, 'message', '排休日期不在当前排班周');
  end if;

  if coalesce(array_length(p_slot_ids, 1), 0) <> v_required_slots then
    return jsonb_build_object('success', false, 'message', '请选择 ' || v_required_slots || ' 个统一出勤时段');
  end if;

  select count(distinct ts.id) into v_valid_slot_count
  from public.time_slots ts
  where ts.week_id = p_week_id
    and ts.is_active
    and ts.is_selectable
    and ts.id = any(coalesce(p_slot_ids, array[]::uuid[]));

  if v_valid_slot_count <> v_required_slots then
    return jsonb_build_object('success', false, 'message', '出勤时段无效或存在重复');
  end if;

  select max_slots into v_limit
  from public.rest_day_limits
  where week_id = p_week_id and team_id = v_team_id and rest_date = p_rest_date;

  if v_limit is null then
    v_limit := public.ensure_default_day_limit(p_week_id, v_team_id, p_rest_date);
  end if;

  select max_slots into v_limit
  from public.rest_day_limits
  where week_id = p_week_id and team_id = v_team_id and rest_date = p_rest_date
  for update;

  select count(*) into v_used
  from public.rider_schedules rs
  join public.riders r
    on r.week_id = rs.week_id and r.rider_id = rs.rider_id
  where rs.week_id = p_week_id
    and r.team_id = v_team_id
    and rs.work_date = p_rest_date
    and rs.slot_id is null
    and rs.rider_id <> p_rider_id;

  if v_used >= v_limit then
    return jsonb_build_object('success', false, 'message', '该日期排休名额已满');
  end if;

  delete from public.rider_schedules
  where week_id = p_week_id and rider_id = p_rider_id;

  v_day := v_week_start;
  while v_day <= v_week_end loop
    if v_day = p_rest_date then
      insert into public.rider_schedules (rider_id, week_id, work_date, slot_id, is_selected)
      values (p_rider_id, p_week_id, v_day, null, null);
    else
      foreach v_slot_id in array coalesce(p_slot_ids, array[]::uuid[])
      loop
        insert into public.rider_schedules (rider_id, week_id, work_date, slot_id, is_selected)
        values (p_rider_id, p_week_id, v_day, v_slot_id, true);
      end loop;
    end if;
    v_day := v_day + 1;
  end loop;

  update public.riders
  set rest_preference_mode = 'specified',
      preference_submitted_at = now()
  where week_id = p_week_id and rider_id = p_rider_id;

  return jsonb_build_object('success', true, 'mode', 'specified', 'restDate', p_rest_date);
end;
$$;

-- 取消排休
create or replace function public.cancel_rider_rest(
  p_rider_id text,
  p_week_id uuid,
  p_work_date date
)
returns jsonb language plpgsql
as $$
begin
  delete from public.rider_schedules
  where week_id = p_week_id and rider_id = p_rider_id and work_date = p_work_date and slot_id is null;
  return jsonb_build_object('success', true);
end;
$$;

-- 获取骑手某周数据
create or replace function public.get_rider_week(
  p_rider_id text,
  p_week_id uuid
)
returns jsonb language plpgsql
as $$
declare
  v_data jsonb;
begin
  select jsonb_agg(jsonb_build_object(
    'workDate', rs.work_date,
    'slotId', rs.slot_id,
    'isSelected', rs.is_selected
  ) order by rs.work_date, rs.slot_id)
  into v_data
  from public.rider_schedules rs
  where rs.rider_id = p_rider_id and rs.week_id = p_week_id;
  return coalesce(v_data, '[]'::jsonb);
end;
$$;

-- 获取某周每日排休人数
create or replace function public.get_week_rest_counts(p_week_id uuid)
returns jsonb language plpgsql
as $$
declare
  v_result jsonb;
begin
  select jsonb_object_agg(to_char(rs.work_date, 'YYYY-MM-DD'), cnt)
  into v_result
  from (
    select work_date, count(*) as cnt
    from public.rider_schedules
    where week_id = p_week_id and slot_id is null
    group by work_date
  ) rs;
  return coalesce(v_result, '{}'::jsonb);
end;
$$;

-- 获取某周每时段选中人数
create or replace function public.get_week_slot_counts(p_week_id uuid)
returns jsonb language plpgsql
as $$
declare
  v_result jsonb;
begin
  select jsonb_object_agg(to_char(rs.work_date, 'YYYY-MM-DD') || '-' || rs.slot_id::text, cnt)
  into v_result
  from (
    select work_date, slot_id, count(*) as cnt
    from public.rider_schedules
    where week_id = p_week_id and slot_id is not null and is_selected = true
    group by work_date, slot_id
  ) rs;
  return coalesce(v_result, '{}'::jsonb);
end;
$$;

-- 确保每日排休名额存在（返回上限）
create or replace function public.ensure_default_day_limit(
  p_week_id uuid,
  p_team_id uuid,
  p_rest_date date
)
returns integer language plpgsql
as $$
declare
  v_max_slots integer;
  v_day integer;
begin
  select max_slots into v_max_slots
  from public.rest_day_limits
  where week_id = p_week_id and team_id = p_team_id and rest_date = p_rest_date;

  if found then return v_max_slots; end if;

  v_day := extract(dow from p_rest_date);
  v_max_slots := case when v_day in (0, 6) then 2 else 5 end;

  insert into public.rest_day_limits (week_id, team_id, rest_date, max_slots)
  values (p_week_id, p_team_id, p_rest_date, v_max_slots)
  on conflict (week_id, team_id, rest_date) do nothing;

  return v_max_slots;
end;
$$;

-- 克隆周时段
create or replace function public.clone_week_slots(
  p_source_week_id uuid,
  p_target_week_id uuid
)
returns void language plpgsql
as $$
begin
  insert into public.time_slots (week_id, name, start_time, end_time, sort_order, is_selectable, is_active)
  select p_target_week_id, name, start_time, end_time, sort_order, is_selectable, is_active
  from public.time_slots
  where week_id = p_source_week_id;
end;
$$;

-- ==================== 6. 触发器 ====================

create trigger trg_sw_updated_at before update on public.schedule_weeks
  for each row execute function public.set_updated_at();
create trigger trg_sw_default_team after insert on public.schedule_weeks
  for each row execute function public.create_default_team_for_week();
create trigger trg_ts_updated_at before update on public.time_slots
  for each row execute function public.set_updated_at();
create trigger trg_rdl_updated_at before update on public.rest_day_limits
  for each row execute function public.set_updated_at();
create trigger trg_rs_updated_at before update on public.rider_schedules
  for each row execute function public.set_updated_at();

-- ==================== 7. RLS ====================

alter table public.schedule_weeks enable row level security;
alter table public.schedule_teams enable row level security;
alter table public.time_slots enable row level security;
alter table public.riders enable row level security;
alter table public.rest_day_limits enable row level security;
alter table public.rider_schedules enable row level security;
alter table public.week_import_snapshots enable row level security;

create policy "public read" on public.schedule_weeks for select to anon, authenticated using (true);
create policy "public write" on public.schedule_weeks for all to anon, authenticated using (true) with check (true);
create policy "public read" on public.schedule_teams for select to anon, authenticated using (true);
create policy "public write" on public.schedule_teams for all to anon, authenticated using (true) with check (true);
create policy "public read" on public.time_slots for select to anon, authenticated using (true);
create policy "public write" on public.time_slots for all to anon, authenticated using (true) with check (true);
create policy "public read" on public.riders for select to anon, authenticated using (true);
create policy "public write" on public.riders for all to anon, authenticated using (true) with check (true);
create policy "public read" on public.rest_day_limits for select to anon, authenticated using (true);
create policy "public write" on public.rest_day_limits for all to anon, authenticated using (true) with check (true);
create policy "public read" on public.rider_schedules for select to anon, authenticated using (true);
create policy "public write" on public.rider_schedules for all to anon, authenticated using (true) with check (true);
create policy "public read" on public.week_import_snapshots for select to anon, authenticated using (true);
create policy "public write" on public.week_import_snapshots for all to anon, authenticated using (true) with check (true);

-- ==================== 8. 权限 ====================

grant usage on schema public to anon, authenticated;
grant all on public.schedule_weeks to anon, authenticated;
grant all on public.schedule_teams to anon, authenticated;
grant all on public.time_slots to anon, authenticated;
grant all on public.riders to anon, authenticated;
grant all on public.rest_day_limits to anon, authenticated;
grant all on public.rider_schedules to anon, authenticated;
grant all on public.week_import_snapshots to anon, authenticated;

grant execute on function public.import_xls_week to anon, authenticated;
grant execute on function public.ensure_default_team to anon, authenticated;
grant execute on function public.export_xls_week to anon, authenticated;
grant execute on function public.clear_week_schedules to anon, authenticated;
grant execute on function public.get_week_riders to anon, authenticated;
grant execute on function public.get_week_slots to anon, authenticated;
grant execute on function public.toggle_slot_selectable to anon, authenticated;
grant execute on function public.set_week_required_slots to anon, authenticated;
grant execute on function public.set_week_default_slots to anon, authenticated;
grant execute on function public.bulk_set_rider_rest to anon, authenticated;
grant execute on function public.bulk_clear_rider_rest to anon, authenticated;
grant execute on function public.bulk_apply_default_slots to anon, authenticated;
grant execute on function public.complete_week_schedules(uuid) to anon, authenticated;
grant execute on function public.bulk_clear_rider_schedules to anon, authenticated;
grant execute on function public.switch_rider_slot to anon, authenticated;
grant execute on function public.toggle_rider_slot to anon, authenticated;
grant execute on function public.set_rider_rest to anon, authenticated;
grant execute on function public.choose_random_rest_preference(text, uuid, uuid[]) to anon, authenticated;
grant execute on function public.submit_specified_schedule(text, uuid, date, uuid[]) to anon, authenticated;
grant execute on function public.cancel_rider_rest to anon, authenticated;
grant execute on function public.get_rider_week to anon, authenticated;
grant execute on function public.get_week_rest_counts to anon, authenticated;
grant execute on function public.get_week_slot_counts to anon, authenticated;
grant execute on function public.ensure_default_day_limit(uuid, uuid, date) to anon, authenticated;
grant execute on function public.clone_week_slots to anon, authenticated;

-- ==================== 9. Realtime ====================

alter publication supabase_realtime add table public.schedule_weeks;
alter publication supabase_realtime add table public.schedule_teams;
alter publication supabase_realtime add table public.time_slots;
alter publication supabase_realtime add table public.riders;
alter publication supabase_realtime add table public.rest_day_limits;
alter publication supabase_realtime add table public.rider_schedules;
