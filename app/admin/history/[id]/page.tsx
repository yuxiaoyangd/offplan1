"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { buildDaysFromRange, formatWeekRange } from "@/lib/date";
import { supabase } from "@/lib/supabase";
import type { RiderRow, RiderScheduleRow, ScheduleTeamRow, ScheduleWeekRow, TimeSlotRow } from "@/lib/types";

export default function HistoryDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const [week, setWeek] = useState<ScheduleWeekRow | null>(null);
  const [riders, setRiders] = useState<RiderRow[]>([]);
  const [teams, setTeams] = useState<ScheduleTeamRow[]>([]);
  const [slots, setSlots] = useState<TimeSlotRow[]>([]);
  const [schedules, setSchedules] = useState<RiderScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [weekRes, ridersRes, teamsRes, slotsRes, schedulesRes] = await Promise.all([
        supabase.from("schedule_weeks").select("*").eq("id", id).maybeSingle(),
        supabase.from("riders").select("*").eq("week_id", id).order("name"),
        supabase.from("schedule_teams").select("*").eq("week_id", id).order("name"),
        supabase.from("time_slots").select("*").eq("week_id", id).order("sort_order"),
        supabase.from("rider_schedules").select("*").eq("week_id", id),
      ]);
      setWeek(weekRes.data as ScheduleWeekRow | null);
      setRiders((ridersRes.data ?? []) as RiderRow[]);
      setTeams((teamsRes.data ?? []) as ScheduleTeamRow[]);
      setSlots((slotsRes.data ?? []) as TimeSlotRow[]);
      setSchedules((schedulesRes.data ?? []) as RiderScheduleRow[]);
      setLoading(false);
    }
    void load();
  }, [id]);

  const teamMap = useMemo(() => Object.fromEntries(teams.map((team) => [team.id, team.name])), [teams]);
  const slotMap = useMemo(() => Object.fromEntries(slots.map((slot) => [slot.id, slot.name])), [slots]);
  const scheduleMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const row of schedules) {
      const key = `${row.rider_id}|${row.work_date}`;
      if (row.slot_id && row.is_selected) map[key] = [...(map[key] ?? []), slotMap[row.slot_id] ?? "未知时段"];
      else if (!row.slot_id) map[key] = [...(map[key] ?? []), "休息"];
    }
    return map;
  }, [schedules, slotMap]);

  if (loading) return <main className="page-container admin-page"><div className="loading-spinner"><div className="spinner" /><span>加载中...</span></div></main>;
  if (!week) return <main className="page-container admin-page"><div className="empty-state"><strong>找不到该历史排班</strong><button className="btn-primary btn-sm" type="button" onClick={() => router.push("/admin/history")}>返回历史排班</button></div></main>;

  const days = buildDaysFromRange(week.start_date, week.end_date);
  return (
    <main className="page-container admin-page history-page">
      <header className="page-header">
        <button className="back-link" type="button" onClick={() => router.push("/admin/history")}>‹ 返回历史排班</button>
        <h1>{week.name || formatWeekRange(week.start_date, week.end_date)}</h1>
        <p>{week.start_date} ~ {week.end_date} · 只读预览</p>
      </header>
      <section className="admin-section">
        <div className="history-summary"><span>{riders.length} 名骑手</span><span>{teams.length} 个小队</span><span>{slots.length} 个时段</span></div>
        <div className="history-table-wrap">
          <table className="history-table">
            <thead><tr><th>骑手</th><th>小队</th>{days.map((day) => <th key={day.key}>{day.label}</th>)}</tr></thead>
            <tbody>
              {riders.map((rider) => (
                <tr key={rider.rider_id}>
                  <td><strong>{rider.name}</strong><small>{rider.rider_id}</small></td>
                  <td>{teamMap[rider.team_id] ?? "默认小队"}</td>
                  {days.map((day) => <td key={day.key}>{(scheduleMap[`${rider.rider_id}|${day.key}`] ?? []).join("、") || "—"}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
