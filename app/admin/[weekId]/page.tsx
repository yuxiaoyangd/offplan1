"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
const CONFIG_HISTORY_GUARD = "__offplanConfigHistoryGuard";

type DateDraft = Pick<ScheduleWeekRow, "name" | "start_date" | "end_date" | "is_active" | "show_feedback_entry">;
type SlotRulesDraft = {
  requiredSlots: number;
  defaultSlotIds: string[];
  selectableById: Record<string, boolean>;
};

function makeDateDraft(week: ScheduleWeekRow): DateDraft {
  return {
    name: week.name,
    start_date: week.start_date,
    end_date: week.end_date,
    is_active: week.is_active,
    show_feedback_entry: week.show_feedback_entry ?? false,
  };
}

function makeSlotRulesDraft(week: ScheduleWeekRow, slots: TimeSlotRow[]): SlotRulesDraft {
  return {
    requiredSlots: week.required_slots ?? 1,
    defaultSlotIds: week.default_slot_ids ?? [],
    selectableById: Object.fromEntries(slots.map((slot) => [slot.id, slot.is_selectable])),
  };
}

function getDefaultLimit(date: string) {
  const day = new Date(`${date}T00:00:00`).getDay();
  return day === 0 || day === 6 ? DEFAULT_WEEKEND_LIMIT : DEFAULT_WEEKDAY_LIMIT;
}

export default function WeekEditPage() {
  const params = useParams();
  const router = useRouter();
  const weekId = params.weekId as string;

  const [week, setWeek] = useState<ScheduleWeekRow | null>(null);
  const [dateDraft, setDateDraft] = useState<DateDraft | null>(null);
  const [slotRulesDraft, setSlotRulesDraft] = useState<SlotRulesDraft | null>(null);
  const [dateDirty, setDateDirty] = useState(false);
  const [slotRulesDirty, setSlotRulesDirty] = useState(false);
  const [savingSection, setSavingSection] = useState<"dates" | "rules" | "limits" | null>(null);
  const [loading, setLoading] = useState(true);
  const [slots, setSlots] = useState<TimeSlotRow[]>([]);
  const [teams, setTeams] = useState<ScheduleTeamRow[]>([]);
  const [riders, setRiders] = useState<RiderRow[]>([]);
  const [schedules, setSchedules] = useState<RiderScheduleRow[]>([]);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [savedLimits, setSavedLimits] = useState<Record<string, number>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [showFeedbackPreview, setShowFeedbackPreview] = useState(false);
  const leaveStateRef = useRef({ hasUnsavedChanges: false, message: "" });
  const historyGuardActiveRef = useRef(false);
  const skipNextPopRef = useRef(false);
  const allowUnloadRef = useRef(false);

  const weekDays = useMemo(() => {
    if (!week) return [];
    return buildDaysFromRange(week.start_date, week.end_date);
  }, [week]);

  const hasDateChanges = !!week && !!dateDraft && (
    dateDraft.name !== week.name ||
    dateDraft.start_date !== week.start_date ||
    dateDraft.end_date !== week.end_date ||
    dateDraft.is_active !== week.is_active ||
    dateDraft.show_feedback_entry !== (week.show_feedback_entry ?? false)
  );
  const hasSlotRulesChanges = !!week && !!slotRulesDraft && (
    slotRulesDraft.requiredSlots !== (week.required_slots ?? 1) ||
    slotRulesDraft.defaultSlotIds.length !== (week.default_slot_ids ?? []).length ||
    slotRulesDraft.defaultSlotIds.some((id) => !(week.default_slot_ids ?? []).includes(id)) ||
    slots.some((slot) => (slotRulesDraft.selectableById[slot.id] ?? slot.is_selectable) !== slot.is_selectable)
  );
  const hasLimitChanges = teams.some((team) => weekDays.some((day) => {
    const key = `${team.id}:${day.key}`;
    return (limits[key] ?? getDefaultLimit(day.key)) !== (savedLimits[key] ?? getDefaultLimit(day.key));
  }));
  const unsavedSections = [
    hasDateChanges ? "日期配置" : null,
    hasSlotRulesChanges ? "时段与排班规则" : null,
    hasLimitChanges ? "小队排休名额" : null,
  ].filter(Boolean).join("、");
  const hasUnsavedChanges = unsavedSections.length > 0;
  const leaveMessage = `${unsavedSections}有修改未保存，确定离开吗？`;

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

  const pendingRandomRestCounts = useMemo(() => {
    const restedRiderIds = new Set(
      schedules.filter((schedule) => schedule.slot_id === null).map((schedule) => schedule.rider_id),
    );
    const counts = new Map<string, number>();
    for (const rider of riders) {
      if (rider.rest_preference_mode !== "random" || restedRiderIds.has(rider.rider_id)) continue;
      counts.set(rider.team_id, (counts.get(rider.team_id) ?? 0) + 1);
    }
    return teams.map((team) => ({
      id: team.id,
      name: team.name,
      count: counts.get(team.id) ?? 0,
    }));
  }, [riders, schedules, teams]);

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
      setDateDraft(weekData ? makeDateDraft(weekData) : null);
      setSlotRulesDraft(weekData ? makeSlotRulesDraft(weekData, slotsRes.data ?? []) : null);
      setDateDirty(false);
      setSlotRulesDirty(false);
      setSlots(slotsRes.data ?? []);
      setTeams(teamsRes.data ?? []);
      setRiders(ridersRes.data ?? []);
      setSchedules(schedulesRes.data ?? []);
      if (limitsRes.data) {
        const loadedLimits = limitsRes.data.reduce<Record<string, number>>((acc, row) => {
          acc[`${row.team_id}:${row.rest_date}`] = row.max_slots;
          return acc;
        }, {});
        setLimits(loadedLimits);
        setSavedLimits(loadedLimits);
      }
      setLoading(false);
    }
    void load();
  }, [weekId]);

  useEffect(() => {
    if (week && !dateDirty) setDateDraft(makeDateDraft(week));
  }, [week, dateDirty]);

  useEffect(() => {
    if (week && !slotRulesDirty) setSlotRulesDraft(makeSlotRulesDraft(week, slots));
  }, [week, slots, slotRulesDirty]);

  useEffect(() => {
    leaveStateRef.current = { hasUnsavedChanges, message: leaveMessage };
  }, [hasUnsavedChanges, leaveMessage]);

  useEffect(() => {
    historyGuardActiveRef.current = window.history.state?.[CONFIG_HISTORY_GUARD] === weekId;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!leaveStateRef.current.hasUnsavedChanges || allowUnloadRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const onPopState = (event: PopStateEvent) => {
      if (skipNextPopRef.current) {
        skipNextPopRef.current = false;
        return;
      }
      if (event.state?.[CONFIG_HISTORY_GUARD] === weekId) {
        historyGuardActiveRef.current = true;
        return;
      }
      if (!historyGuardActiveRef.current) return;

      event.stopImmediatePropagation();
      historyGuardActiveRef.current = false;
      if (leaveStateRef.current.hasUnsavedChanges && !window.confirm(leaveStateRef.current.message)) {
        window.history.pushState({ ...window.history.state, [CONFIG_HISTORY_GUARD]: weekId }, "", window.location.href);
        historyGuardActiveRef.current = true;
        return;
      }

      if (window.history.length <= 2) {
        router.push("/admin");
        return;
      }
      skipNextPopRef.current = true;
      allowUnloadRef.current = true;
      window.history.back();
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("popstate", onPopState, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("popstate", onPopState, true);
    };
  }, [router, weekId]);

  useEffect(() => {
    if (!hasUnsavedChanges || historyGuardActiveRef.current) return;
    window.history.pushState({ ...window.history.state, [CONFIG_HISTORY_GUARD]: weekId }, "", window.location.href);
    historyGuardActiveRef.current = true;
  }, [hasUnsavedChanges, weekId]);

  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(() => setMessage(null), 3000);
    return () => window.clearTimeout(t);
  }, [message]);

  useEffect(() => {
    async function refreshRestSchedules() {
      const { data } = await supabase.from("rider_schedules").select("*").eq("week_id", weekId).is("slot_id", null);
      if (data) setSchedules(data);
    }

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
        if (data) {
          const updatedLimits = data.reduce<Record<string, number>>((acc, row) => {
            acc[`${row.team_id}:${row.rest_date}`] = row.max_slots;
            return acc;
          }, {});
          setLimits(updatedLimits);
          setSavedLimits(updatedLimits);
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "schedule_teams", filter: `week_id=eq.${weekId}` }, async () => {
        const { data } = await supabase.from("schedule_teams").select("*").eq("week_id", weekId).order("name");
        if (data) setTeams(data);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "riders", filter: `week_id=eq.${weekId}` }, async () => {
        const { data } = await supabase.from("riders").select("*").eq("week_id", weekId);
        if (data) setRiders(data);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "rider_schedules", filter: `week_id=eq.${weekId}` }, refreshRestSchedules)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rider_schedules", filter: `week_id=eq.${weekId}` }, refreshRestSchedules)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "rider_schedules" }, (payload) => {
        const deletedWeekId = (payload.old as { week_id?: string }).week_id;
        if (!deletedWeekId || deletedWeekId === weekId) void refreshRestSchedules();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [weekId]);

  async function refreshWeekSettings(parts: { week?: boolean; slots?: boolean; limits?: boolean }) {
    const [weekRes, slotsRes, limitsRes] = await Promise.all([
      parts.week ? supabase.from("schedule_weeks").select("*").eq("id", weekId).maybeSingle() : null,
      parts.slots ? supabase.from("time_slots").select("*").eq("week_id", weekId).order("sort_order") : null,
      parts.limits ? supabase.from("rest_day_limits").select("team_id,rest_date,max_slots").eq("week_id", weekId) : null,
    ]);
    const error = weekRes?.error ?? slotsRes?.error ?? limitsRes?.error;
    if (error) throw error;
    if (weekRes) setWeek(weekRes.data ?? null);
    if (slotsRes) setSlots(slotsRes.data ?? []);
    if (limitsRes) {
      const refreshedLimits = (limitsRes.data ?? []).reduce<Record<string, number>>((acc, row) => {
        acc[`${row.team_id}:${row.rest_date}`] = row.max_slots;
        return acc;
      }, {});
      setLimits(refreshedLimits);
      setSavedLimits(refreshedLimits);
    }
  }

  async function finishSettingsWrite(parts: { week?: boolean; slots?: boolean; limits?: boolean }, successMessage: string) {
    try {
      await refreshWeekSettings(parts);
      setMessage(successMessage);
      return true;
    } catch (error) {
      setMessage(`操作已保存，但页面刷新失败：${error instanceof Error ? error.message : "未知错误"}`);
      return false;
    }
  }

  async function saveWeek() {
    if (!week || !dateDraft || savingSection) return;
    if (!dateDraft.start_date || !dateDraft.end_date) { setMessage("请完整填写起止日期。"); return; }
    setMessage(null);
    setSavingSection("dates");
    try {
      const { error } = await supabase.from("schedule_weeks").update(dateDraft).eq("id", weekId);
      if (error) { setMessage(error.message); return; }
      if (await finishSettingsWrite({ week: true }, "日期配置已保存")) setDateDirty(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存日期配置失败");
    } finally {
      setSavingSection(null);
    }
  }

  function toggleSlotSelectable(slotId: string) {
    setSlotRulesDraft((current) => {
      if (!current) return current;
      const nextSelectable = !current.selectableById[slotId];
      return {
        ...current,
        selectableById: { ...current.selectableById, [slotId]: nextSelectable },
        defaultSlotIds: nextSelectable
          ? current.defaultSlotIds
          : current.defaultSlotIds.filter((id) => id !== slotId),
      };
    });
    setSlotRulesDirty(true);
  }

  async function saveSlotRules() {
    if (!week || !slotRulesDraft || savingSection) return;
    const { requiredSlots, defaultSlotIds, selectableById } = slotRulesDraft;
    if (!Number.isInteger(requiredSlots) || requiredSlots < 0 || requiredSlots > 10) {
      setMessage("必选时段数需在 0 到 10 之间");
      return;
    }
    if (defaultSlotIds.length > requiredSlots) {
      setMessage(`默认时段最多选择 ${requiredSlots} 个`);
      return;
    }
    setMessage(null);
    setSavingSection("rules");
    try {
      const { data, error } = await supabase.rpc("save_week_slot_rules", {
        p_week_id: week.id,
        p_required_slots: requiredSlots,
        p_default_slot_ids: defaultSlotIds,
        p_slot_ids: slots.map((slot) => slot.id),
        p_selectable_flags: slots.map((slot) => selectableById[slot.id] ?? slot.is_selectable),
      });
      if (error || data?.success === false) {
        setMessage(error?.message ?? data?.message ?? "保存排班规则失败");
        return;
      }
      if (await finishSettingsWrite({ week: true, slots: true }, "排班规则已保存")) setSlotRulesDirty(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存排班规则失败");
    } finally {
      setSavingSection(null);
    }
  }

  function toggleDefaultSlot(slotId: string) {
    if (!slotRulesDraft) return;
    const currentIds = slotRulesDraft.defaultSlotIds;
    const isSelected = currentIds.includes(slotId);
    if (!isSelected && currentIds.length >= slotRulesDraft.requiredSlots) {
      setMessage(`默认时段最多选择 ${slotRulesDraft.requiredSlots} 个`);
      return;
    }
    const nextIds = isSelected ? currentIds.filter((id) => id !== slotId) : [...currentIds, slotId];
    setSlotRulesDraft({ ...slotRulesDraft, defaultSlotIds: nextIds });
    setSlotRulesDirty(true);
  }

  async function saveAllLimits() {
    if (!week || savingSection) return;
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
    setSavingSection("limits");
    try {
      const { error } = await supabase.from("rest_day_limits").upsert(rows, { onConflict: "week_id,team_id,rest_date" });
      if (error) { setMessage(error.message); return; }
      await finishSettingsWrite({ limits: true }, "名额已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存名额失败");
    } finally {
      setSavingSection(null);
    }
  }

  function returnToAdmin() {
    if (hasUnsavedChanges && !window.confirm(leaveMessage)) return;
    router.push("/admin");
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
        <button className="btn-primary" type="button" onClick={returnToAdmin}>返回管理端</button>
      </main>
    );
  }

  if (!dateDraft || !slotRulesDraft) {
    return <main className="page-container"><div className="loading-spinner"><div className="spinner" /><span className="loading-text">加载中...</span></div></main>;
  }

  return (
    <main className="page-container admin-page config-page">
      <header className="page-header">
        <div className="page-header-back-row">
          <button className="btn-ghost btn-sm" type="button" onClick={returnToAdmin}>← 返回</button>
          <h1>排班配置</h1>
        </div>
        <p>{formatWeekRange(week.start_date, week.end_date)}</p>
      </header>
      {message ? <div className="toast-pill">{message}</div> : null}

      {/* 日期配置 */}
      <section className="admin-section" aria-busy={savingSection === "dates"}>
        <div className="section-header">
          <div>
            <h2>日期配置</h2>
            <p>排班周基本信息</p>
          </div>
          <button className={`btn-primary btn-sm config-save-button ${!hasDateChanges ? "config-save-idle" : ""}`} type="button"
            onClick={() => { if (hasDateChanges) void saveWeek(); else setMessage("暂无改动"); }} disabled={savingSection !== null}>
            {savingSection === "dates" ? "保存中..." : "保存日期配置"}
          </button>
        </div>
        <div className="week-basics-grid">
          <label className="config-field">
            <span>排班名称</span>
            <input type="text" className="clean-input" value={dateDraft.name} disabled={savingSection !== null}
              onChange={(e) => { setDateDraft((cur) => cur ? { ...cur, name: e.target.value } : null); setDateDirty(true); }} placeholder="例如：第一周、A队排班等" />
          </label>
          <label className="config-field">
            <span>开始日期</span>
            <input type="date" className="clean-input" value={dateDraft.start_date} disabled={savingSection !== null}
              onChange={(e) => { setDateDraft((cur) => cur ? { ...cur, start_date: e.target.value } : null); setDateDirty(true); }} />
          </label>
          <label className="config-field">
            <span>结束日期</span>
            <input type="date" className="clean-input" value={dateDraft.end_date} disabled={savingSection !== null}
              onChange={(e) => { setDateDraft((cur) => cur ? { ...cur, end_date: e.target.value } : null); setDateDirty(true); }} />
          </label>
          <label className="switch-label publish-switch">
            <input type="checkbox" checked={dateDraft.is_active} disabled={savingSection !== null}
              onChange={(e) => { setDateDraft((cur) => cur ? { ...cur, is_active: e.target.checked } : null); setDateDirty(true); }} />
            发布此周
          </label>
          <label className="switch-label feedback-entry-setting">
            <input type="checkbox" checked={dateDraft.show_feedback_entry} disabled={savingSection !== null}
              onChange={(e) => { setDateDraft((cur) => cur ? { ...cur, show_feedback_entry: e.target.checked } : null); setDateDirty(true); }} />
            显示投诉或建议入口
            <button className="config-info-wrap" type="button" aria-label="查看骑手提交成功页面示例"
              onClick={(event) => { event.preventDefault(); event.stopPropagation(); setShowFeedbackPreview(true); }}>
              <span className="config-info-icon" aria-hidden="true">i</span>
            </button>
          </label>
        </div>
      </section>

      {/* 时段与排班规则 */}
      <section className="admin-section" aria-busy={savingSection === "rules"}>
          <div className="section-header">
            <div>
              <h2>时段与排班规则</h2>
              <p>统一管理可选时段、每天必选数量和默认时段</p>
            </div>
            <button className={`btn-primary btn-sm config-save-button ${!hasSlotRulesChanges ? "config-save-idle" : ""}`} type="button"
              onClick={() => { if (hasSlotRulesChanges) void saveSlotRules(); else setMessage("暂无改动"); }} disabled={savingSection !== null}>
              {savingSection === "rules" ? "保存中..." : "保存排班规则"}
            </button>
          </div>
          <div className="slot-policy-bar">
            <label className="required-slot-control">
              <span>每人每天必须选</span>
              <input className="clean-input" type="number" min={0} max={10} value={slotRulesDraft.requiredSlots} disabled={savingSection !== null}
                onChange={(event) => {
                  const value = event.target.value;
                  setSlotRulesDraft((current) => current ? { ...current, requiredSlots: value === "" ? 0 : Number(value) } : null);
                  setSlotRulesDirty(true);
                }} />
              <span>个时段</span>
            </label>
            <div className="default-slot-status">
              <span>默认时段</span>
              <strong>{slotRulesDraft.defaultSlotIds.length}/{slotRulesDraft.requiredSlots}</strong>
            </div>
          </div>
          {slots.length > 0 ? (
            <div className="slot-config-grid">
              {slots.map((slot) => (
              <div className={`slot-config-item ${slotRulesDraft.defaultSlotIds.includes(slot.id) ? "default-active" : ""}`} key={slot.id}>
                <div className="slot-config-copy">
                  <strong>{slot.name}</strong>
                  <span>{slot.start_time.slice(0, 5)}-{slot.end_time.slice(0, 5)}</span>
                </div>
                <div className="slot-config-actions">
                  <label className="switch-label">
                    <input type="checkbox" checked={slotRulesDraft.selectableById[slot.id] ?? slot.is_selectable}
                      disabled={savingSection !== null} onChange={() => toggleSlotSelectable(slot.id)} />
                    可选
                  </label>
                  <button
                    className={`default-slot-toggle ${slotRulesDraft.defaultSlotIds.includes(slot.id) ? "active" : ""}`}
                    type="button"
                    disabled={savingSection !== null || !(slotRulesDraft.selectableById[slot.id] ?? slot.is_selectable)}
                    onClick={() => toggleDefaultSlot(slot.id)}
                  >
                    {slotRulesDraft.defaultSlotIds.includes(slot.id) ? "取消默认" : "设为默认"}
                  </button>
                </div>
              </div>
              ))}
            </div>
          ) : (
            <div className="slot-config-empty">
              <strong>暂无可配置时段</strong>
              <span>需先导入骑手时段意愿 XLS 文件</span>
            </div>
          )}
      </section>

      {/* 分小队每日休息名额 */}
      {weekDays.length > 0 && teams.length > 0 ? (
        <section className="admin-section" aria-busy={savingSection === "limits"}>
          <div className="section-header">
            <div>
              <h2>小队排休名额</h2>
              <p>
                {teams.length === 1 && teams[0].is_default ? "当前使用默认小队" : `已识别 ${teams.length} 个小队`}，名额按小队分别计算；
                已选随机排休人员：{pendingRandomRestCounts.map((team, index) => (
                  <span key={team.id}>
                    {index > 0 ? " · " : ""}<strong>{team.name} {team.count} 人</strong>
                  </span>
                ))} · 总计 <strong>{pendingRandomRestCounts.reduce((total, team) => total + team.count, 0)} 人</strong>
              </p>
            </div>
            <button className={`btn-primary btn-sm config-save-button ${!hasLimitChanges ? "config-save-idle" : ""}`} type="button"
              onClick={() => { if (hasLimitChanges) void saveAllLimits(); else setMessage("暂无改动"); }} disabled={savingSection !== null}>
              {savingSection === "limits" ? "保存中..." : "保存名额"}
            </button>
          </div>
          <div className="quota-table-wrap">
            <table className="quota-table">
              <thead>
                <tr>
                  <th>小队</th>
                  {weekDays.map((day) => {
                    const configuredRestCount = teams.reduce(
                      (total, team) => total + (limits[`${team.id}:${day.key}`] ?? getDefaultLimit(day.key)),
                      0,
                    );
                    const staffingRate = riders.length > 0
                      ? (((riders.length - configuredRestCount) / riders.length) * 100).toFixed(1).replace(/\.0$/, "")
                      : "0";
                    return (
                      <th key={day.key}>
                        <strong>{day.weekdayLabel}</strong>
                        <span>{day.shortDate}</span>
                        <span>排班率：{staffingRate}%</span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {teams.map((team) => {
                  const teamRiderCount = riders.filter((rider) => rider.team_id === team.id).length;
                  const configuredQuotaCount = weekDays.reduce(
                    (total, day) => total + (limits[`${team.id}:${day.key}`] ?? getDefaultLimit(day.key)),
                    0,
                  );
                  return (
                  <tr key={team.id}>
                    <th>
                      <strong>{team.name}</strong>
                      <span
                        className="quota-summary"
                        aria-label={`已配置休息名额 ${configuredQuotaCount}，总人数 ${teamRiderCount}`}
                      >
                        <strong className="quota-summary-configured">{configuredQuotaCount}</strong>
                        <span className="quota-summary-total"> / {teamRiderCount}</span>
                      </span>
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
                            disabled={savingSection !== null}
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {showFeedbackPreview ? (
        <div className="feedback-preview-overlay" role="dialog" aria-modal="true" aria-label="骑手提交成功页面示例" onClick={() => setShowFeedbackPreview(false)}>
          <div className="feedback-preview-card" onClick={(event) => event.stopPropagation()}>
            <button className="feedback-preview-close" type="button" aria-label="关闭示例图片" onClick={() => setShowFeedbackPreview(false)}>×</button>
            <img src="/images/feedback-example.png" alt="骑手提交成功页面示例" />
          </div>
        </div>
      ) : null}
    </main>
  );
}
