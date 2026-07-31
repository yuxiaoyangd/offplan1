"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { buildDaysFromRange, formatWeekRange, getWeekStart, formatDateKey } from "@/lib/date";
import { supabase } from "@/lib/supabase";
import type {
  RiderRow,
  RiderScheduleRow,
  ScheduleTeamRow,
  ScheduleWeekRow,
  TimeSlotRow,
} from "@/lib/types";

const DEFAULT_WEEKDAY_LIMIT = 5;
const DEFAULT_WEEKEND_LIMIT = 2;

function getDefaultLimit(date: string) {
  const day = new Date(`${date}T00:00:00`).getDay();
  return day === 0 || day === 6 ? DEFAULT_WEEKEND_LIMIT : DEFAULT_WEEKDAY_LIMIT;
}

export default function WeekEditPage() {
  const params = useParams();
  const router = useRouter();
  const weekId = params.weekId as string;

  const [week, setWeek] = useState<ScheduleWeekRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [slots, setSlots] = useState<TimeSlotRow[]>([]);
  const [teams, setTeams] = useState<ScheduleTeamRow[]>([]);
  const [riders, setRiders] = useState<RiderRow[]>([]);
  const [schedules, setSchedules] = useState<RiderScheduleRow[]>([]);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [message, setMessage] = useState<string | null>(null);

  const weekDays = useMemo(() => {
    if (!week) return [];
    return buildDaysFromRange(week.start_date, week.end_date);
  }, [week]);

  const riderTeamMap = useMemo(
    () => new Map(riders.map((rider) => [rider.rider_id, rider.team_id])),
    [riders],
  );

  const usedLimits = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const schedule of schedules) {
      if (schedule.slot_id !== null) continue;
      const teamId = riderTeamMap.get(schedule.rider_id);
      if (!teamId) continue;
      const key = `${teamId}:${schedule.work_date}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [riderTeamMap, schedules]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data: weekData } = await supabase.from("schedule_weeks").select("*").eq("id", weekId).maybeSingle();
      const [slotsRes, teamsRes, limitsRes, ridersRes, schedulesRes] = await Promise.all([
        supabase.from("time_slots").select("*").eq("week_id", weekId).order("sort_order"),
        supabase.from("schedule_teams").select("*").eq("week_id", weekId).order("name"),
        weekData
          ? supabase.from("rest_day_limits").select("team_id,rest_date,max_slots").eq("week_id", weekData.id)
          : Promise.resolve({ data: [], error: null }),
        supabase.from("riders").select("*").eq("week_id", weekId),
        supabase.from("rider_schedules").select("*").eq("week_id", weekId).is("slot_id", null),
      ]);
      setWeek(weekData ?? null);
      setSlots(slotsRes.data ?? []);
      setTeams(teamsRes.data ?? []);
      setRiders(ridersRes.data ?? []);
      setSchedules(schedulesRes.data ?? []);
      if (limitsRes.data) {
        setLimits(limitsRes.data.reduce<Record<string, number>>((acc, row) => {
          acc[`${row.team_id}:${row.rest_date}`] = row.max_slots;
          return acc;
        }, {}));
      }
      setLoading(false);
    }
    void load();
  }, [weekId]);

  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(() => setMessage(null), 2500);
    return () => window.clearTimeout(t);
  }, [message]);

  useEffect(() => {
    const channel = supabase
      .channel(`week-edit-${weekId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "schedule_weeks", filter: `id=eq.${weekId}` }, async () => {
        const { data } = await supabase.from("schedule_weeks").select("*").eq("id", weekId).maybeSingle();
        if (data) setWeek(data);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "time_slots", filter: `week_id=eq.${weekId}` }, async () => {
        const { data } = await supabase.from("time_slots").select("*").eq("week_id", weekId).order("sort_order");
        if (data) setSlots(data);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "rest_day_limits", filter: `week_id=eq.${weekId}` }, async () => {
        const { data } = await supabase.from("rest_day_limits").select("team_id,rest_date,max_slots").eq("week_id", weekId);
        if (data) setLimits(data.reduce<Record<string, number>>((acc, row) => {
          acc[`${row.team_id}:${row.rest_date}`] = row.max_slots;
          return acc;
        }, {}));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "schedule_teams", filter: `week_id=eq.${weekId}` }, async () => {
        const { data } = await supabase.from("schedule_teams").select("*").eq("week_id", weekId).order("name");
        if (data) setTeams(data);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "rider_schedules", filter: `week_id=eq.${weekId}` }, async () => {
        const { data } = await supabase.from("rider_schedules").select("*").eq("week_id", weekId).is("slot_id", null);
        if (data) setSchedules(data);
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [weekId]);

  async function saveWeek() {
    if (!week?.start_date || !week?.end_date) { setMessage("请完整填写起止日期。"); return; }
    setMessage(null);
    const { error } = await supabase.from("schedule_weeks").update({
      name: week.name,
      start_date: week.start_date,
      end_date: week.end_date,
      is_active: week.is_active,
      required_slots: week.required_slots ?? 3,
      default_slot_ids: week.default_slot_ids,
    }).eq("id", weekId);
    if (error) { setMessage(error.message); return; }
    setMessage("排休周已保存。");
  }

  async function toggleSlotSelectable(slotId: string) {
    const { error } = await supabase.rpc("toggle_slot_selectable", { p_slot_id: slotId });
    if (error) setMessage(error.message);
  }

  async function setWeekRequiredSlots(requiredSlots: number) {
    if (!Number.isInteger(requiredSlots) || requiredSlots < 0 || requiredSlots > 10) {
      setMessage("必选时段数需在 0 到 10 之间");
      return;
    }
    const { error } = await supabase.rpc("set_week_required_slots", { p_week_id: weekId, p_required_slots: requiredSlots });
    if (error) setMessage(error.message);
  }

  async function setWeekDefaultSlots(defaultSlotIds: string[]) {
    const { error } = await supabase.rpc("set_week_default_slots", { p_week_id: weekId, p_default_slot_ids: defaultSlotIds });
    if (error) setMessage(error.message);
  }

  async function saveAllLimits() {
    if (!week) return;
    setMessage(null);
    const rows = teams.flatMap((team) => weekDays.map((day) => {
      const key = `${team.id}:${day.key}`;
      return {
        week_id: week.id,
        team_id: team.id,
        rest_date: day.key,
        max_slots: limits[key] ?? getDefaultLimit(day.key),
      };
    }));
    const invalidRow = rows.find((row) => row.max_slots < (usedLimits[`${row.team_id}:${row.rest_date}`] ?? 0));
    if (invalidRow) {
      const teamName = teams.find((team) => team.id === invalidRow.team_id)?.name ?? "该小队";
      setMessage(`${teamName} ${invalidRow.rest_date} 的名额不能低于已排休人数`);
      return;
    }
    const { error } = await supabase.from("rest_day_limits").upsert(rows, { onConflict: "week_id,team_id,rest_date" });
    if (error) { setMessage(error.message); return; }
    setMessage("名额已保存");
  }

  if (loading) {
    return (
      <main className="page-container">
        <div className="loading-spinner"><div className="spinner" /><span className="loading-text">加载中...</span></div>
      </main>
    );
  }

  if (!week) {
    return (
      <main className="page-container">
        <header className="page-header">
          <h1>排班配置</h1>
          <p>该周不存在或已被删除</p>
        </header>
        <div className="empty-state">请联系管理员获取新的排班链接。</div>
        <button className="btn-primary" type="button" onClick={() => router.push("/admin")}>返回管理端</button>
      </main>
    );
  }

  return (
    <main className="page-container">
      <header className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button className="btn-ghost btn-sm" type="button" onClick={() => router.push("/admin")}>← 返回</button>
          <h1>排班配置</h1>
        </div>
        <p>{formatWeekRange(week.start_date, week.end_date)}</p>
      </header>
      {message ? <div className="toast-pill">{message}</div> : null}

      {/* 日期配置 */}
      <section className="admin-section">
        <div className="section-header">
          <div>
            <h2>日期配置</h2>
            <p>设置排休周的名称、起止日期和状态</p>
          </div>
        </div>
        <div className="config-card" style={{ maxWidth: "600px" }}>
          <div className="input-group">
            <label style={{ fontSize: "14px", fontWeight: 600, marginBottom: "8px", display: "block" }}>排班名称</label>
            <input type="text" className="clean-input" value={week.name}
              onChange={(e) => setWeek((cur) => cur ? { ...cur, name: e.target.value } : null)} placeholder="例如：第一周、A队排班等" />
          </div>
          <div className="input-group">
            <label style={{ fontSize: "14px", fontWeight: 600, marginBottom: "8px", display: "block" }}>开始日期</label>
            <input type="date" className="clean-input" value={week.start_date}
              onChange={(e) => setWeek((cur) => cur ? { ...cur, start_date: e.target.value } : null)} />
          </div>
          <div className="input-group">
            <label style={{ fontSize: "14px", fontWeight: 600, marginBottom: "8px", display: "block" }}>结束日期</label>
            <input type="date" className="clean-input" value={week.end_date}
              onChange={(e) => setWeek((cur) => cur ? { ...cur, end_date: e.target.value } : null)} />
          </div>
          <label className="switch-label" style={{ marginTop: "8px" }}>
            <input type="checkbox" checked={week.is_active}
              onChange={(e) => setWeek((cur) => cur ? { ...cur, is_active: e.target.checked } : null)} />
            发布此周
          </label>
          <div className="card-actions-row" style={{ marginTop: "16px" }}>
            <button className="btn-primary" type="button" onClick={saveWeek}>保存</button>
          </div>
        </div>
      </section>

      {/* 时段配置 */}
      {slots.length > 0 ? (
        <section className="admin-section">
          <div className="section-header">
            <div>
              <h2>时段配置</h2>
              <p>标记「可选」的时段骑手可在端上自由选择</p>
            </div>
          </div>
          <div className="config-grid">
            {slots.map((slot) => (
              <div className="config-card" key={slot.id} style={{ flexDirection: "row", alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                  <strong>{slot.name}</strong>
                  <span style={{ fontSize: "12px", color: "var(--text-muted)", display: "block" }}>{slot.start_time.slice(0, 5)}-{slot.end_time.slice(0, 5)}</span>
                </div>
                <label className="switch-label" style={{ cursor: "pointer" }}>
                  <input type="checkbox" checked={slot.is_selectable} onChange={() => toggleSlotSelectable(slot.id)} />
                  可选
                </label>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* 每周必须选时段数 */}
      {slots.length > 0 ? (
        <section className="admin-section">
          <div className="section-header">
            <div>
              <h2>排班要求</h2>
              <p>规定每人每天必须选几个时段</p>
            </div>
          </div>
          <div className="config-card" style={{ flexDirection: "row", alignItems: "center", maxWidth: "400px" }}>
            <div style={{ flex: 1 }}>
              <strong>每人每天必须选</strong>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <input className="clean-input" type="number" min={0} max={10} value={week.required_slots ?? 3}
                onChange={(e) => {
                  const value = e.target.value;
                  setWeek((cur) => cur ? { ...cur, required_slots: value === "" ? 0 : Number(value) } : null);
                }}
                onBlur={(e) => {
                  const value = Number(e.target.value);
                  if (!Number.isInteger(value) || value < 0 || value > 10) {
                    setWeek((cur) => cur ? { ...cur, required_slots: 3 } : null);
                    setMessage("必选时段数需在 0 到 10 之间");
                    return;
                  }
                  void setWeekRequiredSlots(value);
                }}
                style={{ width: "60px", padding: "6px", textAlign: "center" }} />
              <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>个时段</span>
            </div>
          </div>
        </section>
      ) : null}

      {/* 默认时段选择 */}
      {slots.length > 0 ? (
        <section className="admin-section">
          <div className="section-header">
            <div>
              <h2>默认时段选择</h2>
              <p>设置员工自动选中的默认时段（仅从可选时段中选择）</p>
            </div>
          </div>
          <div className="config-card" style={{ maxWidth: "600px" }}>
            <div style={{ marginBottom: "12px", fontSize: "13px", color: "var(--text-muted)" }}>
              已选 {week.default_slot_ids?.length ?? 0}/{week.required_slots ?? 3} 个默认时段
            </div>
            <div className="config-grid">
              {slots.filter(s => s.is_selectable).map((slot) => {
                const isSelected = week.default_slot_ids?.includes(slot.id) ?? false;
                return (
                  <button
                    className={`config-card ${isSelected ? "active-card" : ""} selectable-card`}
                    key={slot.id}
                    type="button"
                    onClick={() => {
                      const currentIds = week.default_slot_ids ?? [];
                      const newIds = isSelected
                        ? currentIds.filter(id => id !== slot.id)
                        : [...currentIds, slot.id];
                      setWeek((cur) => cur ? { ...cur, default_slot_ids: newIds } : null);
                      void setWeekDefaultSlots(newIds);
                    }}
                  >
                    <div style={{ flex: 1, textAlign: "left" }}>
                      <strong>{slot.name}</strong>
                      <span style={{ fontSize: "12px", color: "var(--text-muted)", display: "block" }}>
                        {slot.start_time.slice(0, 5)}-{slot.end_time.slice(0, 5)}
                      </span>
                    </div>
                    {isSelected ? (
                      <span className="selection-check" aria-hidden="true">✓</span>
                    ) : (
                      <span className="selection-hint">点击选择</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      {/* 分小队每日休息名额 */}
      {weekDays.length > 0 && teams.length > 0 ? (
        <section className="admin-section">
          <div className="section-header">
            <div>
              <h2>小队排休名额</h2>
              <p>{teams.length === 1 && teams[0].is_default ? "当前使用默认小队" : `已识别 ${teams.length} 个小队`}，名额按小队分别计算</p>
            </div>
            <button className="btn-primary btn-sm" type="button" onClick={saveAllLimits}>保存名额</button>
          </div>
          <div className="quota-table-wrap">
            <table className="quota-table">
              <thead>
                <tr>
                  <th>小队</th>
                  {weekDays.map((day) => (
                    <th key={day.key}>
                      <strong>{day.weekdayLabel}</strong>
                      <span>{day.shortDate}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {teams.map((team) => (
                  <tr key={team.id}>
                    <th>
                      <strong>{team.name}</strong>
                      <span>{riders.filter((rider) => rider.team_id === team.id).length} 人</span>
                    </th>
                    {weekDays.map((day) => {
                      const key = `${team.id}:${day.key}`;
                      const used = usedLimits[key] ?? 0;
                      const maxSlots = limits[key] ?? getDefaultLimit(day.key);
                      return (
                        <td key={day.key}>
                          <input
                            aria-label={`${team.name} ${day.weekdayLabel}排休名额`}
                            className="quota-input"
                            type="number"
                            min={used}
                            max={50}
                            value={maxSlots}
                            onChange={(event) => setLimits((current) => ({
                              ...current,
                              [key]: Number(event.target.value),
                            }))}
                          />
                          <span className={used >= maxSlots ? "quota-usage quota-full" : "quota-usage"}>
                            已用 {used}/{maxSlots}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}
