"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { buildDaysFromRange, formatWeekRange } from "@/lib/date";
import { supabase } from "@/lib/supabase";
import type { RiderRow, RiderScheduleRow, ScheduleWeekRow, TimeSlotRow } from "@/lib/types";

const STORAGE_KEY = "offplan.employeeInfo";
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WEEKDAY_LIMIT = 5;
const DEFAULT_WEEKEND_LIMIT = 2;

type RpcResult = {
  success?: boolean;
  message?: string;
};

function getDefaultLimit(date: string) {
  const day = new Date(`${date}T00:00:00`).getDay();
  return day === 0 || day === 6 ? DEFAULT_WEEKEND_LIMIT : DEFAULT_WEEKDAY_LIMIT;
}

async function loadTeamRestAvailability(weekId: string, teamId: string) {
  const [limitsRes, teamRidersRes, teamRes] = await Promise.all([
    supabase.from("rest_day_limits").select("rest_date,max_slots").eq("week_id", weekId).eq("team_id", teamId),
    supabase.from("riders").select("rider_id").eq("week_id", weekId).eq("team_id", teamId),
    supabase.from("schedule_teams").select("name").eq("id", teamId).maybeSingle(),
  ]);
  const riderIds = (teamRidersRes.data ?? []).map((row) => row.rider_id);
  const restCountsRes = riderIds.length > 0
    ? await supabase
      .from("rider_schedules")
      .select("work_date")
      .eq("week_id", weekId)
      .in("rider_id", riderIds)
      .is("slot_id", null)
    : { data: [] as { work_date: string }[] };

  const limits = (limitsRes.data ?? []).reduce<Record<string, number>>((acc, row) => {
    acc[row.rest_date] = row.max_slots;
    return acc;
  }, {});
  const counts: Record<string, number> = {};
  for (const row of restCountsRes.data ?? []) {
    counts[row.work_date] = (counts[row.work_date] ?? 0) + 1;
  }

  return { limits, counts, teamName: teamRes.data?.name ?? "" };
}

export default function WeekSchedulePage() {
  const params = useParams();
  const weekId = params.id as string;

  const [week, setWeek] = useState<ScheduleWeekRow | null>(null);
  const [weekLoading, setWeekLoading] = useState(true);
  const [rider, setRider] = useState<RiderRow | null>(null);
  const [draftName, setDraftName] = useState("");
  const [allSlots, setAllSlots] = useState<TimeSlotRow[]>([]);
  const [schedules, setSchedules] = useState<RiderScheduleRow[]>([]);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [allRestCounts, setAllRestCounts] = useState<Record<string, number>>({});
  const [teamName, setTeamName] = useState("");
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showNameGate, setShowNameGate] = useState(false);
  const [draftMode, setDraftMode] = useState<"random" | "specified" | null>(null);
  const [confirmRandom, setConfirmRandom] = useState(false);
  const [confirmSpecified, setConfirmSpecified] = useState(false);
  const [selectedRestDate, setSelectedRestDate] = useState("");
  const [uniformSlotIds, setUniformSlotIds] = useState<string[]>([]);
  const [schedulesLoaded, setSchedulesLoaded] = useState(false);
  const [initializedRiderId, setInitializedRiderId] = useState<string | null>(null);

  const selectableSlots = useMemo(
    () => allSlots.filter((slot) => slot.is_selectable && slot.is_active).sort((a, b) => a.sort_order - b.sort_order),
    [allSlots],
  );
  const requiredSlots = week?.required_slots ?? 1;
  const weekDays = useMemo(
    () => week ? buildDaysFromRange(week.start_date, week.end_date) : [],
    [week],
  );
  const existingRestDate = useMemo(
    () => schedules.find((entry) => entry.slot_id === null)?.work_date ?? "",
    [schedules],
  );
  const slotMap = useMemo(
    () => Object.fromEntries(allSlots.map((slot) => [slot.id, slot])),
    [allSlots],
  );

  useEffect(() => {
    async function loadWeek() {
      setWeekLoading(true);
      const [weekRes, slotsRes] = await Promise.all([
        supabase.from("schedule_weeks").select("*").eq("id", weekId).maybeSingle(),
        supabase.from("time_slots").select("*").eq("week_id", weekId).order("sort_order"),
      ]);
      const weekData = weekRes.data ?? null;
      if (weekData && !weekData.is_active) {
        setMessage("该排休周尚未发布，请联系管理员");
        setWeek(null);
        setAllSlots([]);
      } else {
        setWeek(weekData);
        setAllSlots(slotsRes.data ?? []);
      }
      setWeekLoading(false);
    }
    void loadWeek();
  }, [weekId]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const now = Date.now();
        if (parsed?.name && (!parsed.timestamp || now - parsed.timestamp < CACHE_DURATION_MS)) {
          setDraftName(parsed.name);
          setRider(parsed);
          return;
        }
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    setShowNameGate(true);
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 3000);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (!week || !rider?.rider_id) {
      setSchedules([]);
      setSchedulesLoaded(false);
      return;
    }
    const riderId = rider.rider_id;

    async function load() {
      const [currentRiderRes, schedulesRes] = await Promise.all([
        supabase.from("riders").select("*").eq("week_id", week!.id).eq("rider_id", riderId).maybeSingle(),
        supabase.from("rider_schedules").select("*").eq("week_id", week!.id).eq("rider_id", riderId),
      ]);
      const currentRider = currentRiderRes.data as RiderRow | null;
      if (!currentRider) {
        setShowNameGate(true);
        return;
      }
      const availability = await loadTeamRestAvailability(week!.id, currentRider.team_id);
      setRider(currentRider);
      setSchedules((schedulesRes.data ?? []) as RiderScheduleRow[]);
      setLimits(availability.limits);
      setAllRestCounts(availability.counts);
      setTeamName(availability.teamName);
      setSchedulesLoaded(true);
    }
    void load();
  }, [week, rider?.rider_id]);

  useEffect(() => {
    if (!rider || !week || !schedulesLoaded || initializedRiderId === rider.rider_id) return;
    const selectableIds = new Set(selectableSlots.map((slot) => slot.id));
    const firstWorkDate = weekDays.find((day) =>
      schedules.some((entry) => entry.work_date === day.key && entry.slot_id !== null && entry.is_selected),
    )?.key;
    const savedSlots = firstWorkDate
      ? schedules
        .filter((entry) => entry.work_date === firstWorkDate && entry.slot_id && entry.is_selected && selectableIds.has(entry.slot_id))
        .map((entry) => entry.slot_id!)
      : [];
    const defaults = (week.default_slot_ids ?? []).filter((id) => selectableIds.has(id)).slice(0, requiredSlots);

    setSelectedRestDate(existingRestDate);
    setUniformSlotIds(savedSlots.length > 0 ? savedSlots : defaults);
    setDraftMode(rider.rest_preference_mode === "specified" ? "specified" : null);
    setInitializedRiderId(rider.rider_id);
  }, [
    existingRestDate,
    initializedRiderId,
    requiredSlots,
    rider,
    schedules,
    schedulesLoaded,
    selectableSlots,
    week,
    weekDays,
  ]);

  async function refreshRiderSchedules() {
    if (!week || !rider?.rider_id) return;
    const [schedulesRes, riderRes] = await Promise.all([
      supabase.from("rider_schedules").select("*").eq("week_id", week.id).eq("rider_id", rider.rider_id),
      supabase.from("riders").select("*").eq("week_id", week.id).eq("rider_id", rider.rider_id).maybeSingle(),
    ]);
    const currentRider = riderRes.data as RiderRow | null;
    setSchedules((schedulesRes.data ?? []) as RiderScheduleRow[]);
    if (currentRider) {
      const availability = await loadTeamRestAvailability(week.id, currentRider.team_id);
      setRider(currentRider);
      setLimits(availability.limits);
      setAllRestCounts(availability.counts);
      setTeamName(availability.teamName);
    }
    setSchedulesLoaded(true);
  }

  useEffect(() => {
    if (!week) return;
    const channel = supabase
      .channel(`employee-week-${week.id}-${rider?.rider_id ?? "anonymous"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rider_schedules", filter: `week_id=eq.${week.id}` }, () => {
        void refreshRiderSchedules();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "rest_day_limits", filter: `week_id=eq.${week.id}` }, () => {
        void refreshRiderSchedules();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "riders", filter: `week_id=eq.${week.id}` }, () => {
        void refreshRiderSchedules();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [week?.id, rider?.rider_id]);

  async function saveEmployeeName() {
    const trimmed = draftName.trim();
    if (!trimmed) {
      setMessage("请填写姓名");
      return;
    }
    setSubmittingKey("name");
    const { data, error } = await supabase
      .from("riders")
      .select("*")
      .eq("week_id", weekId)
      .ilike("name", trimmed)
      .maybeSingle();
    setSubmittingKey(null);

    if (error || !data) {
      setMessage(`“${trimmed}”不在当前排班周的骑手名单中，请联系管理员`);
      return;
    }
    const currentRider = data as RiderRow;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      rider_id: currentRider.rider_id,
      name: currentRider.name,
      timestamp: Date.now(),
    }));
    setInitializedRiderId(null);
    setRider(currentRider);
    setShowNameGate(false);
    setMessage(`欢迎，${currentRider.name}`);
  }

  function toggleUniformSlot(slotId: string) {
    setUniformSlotIds((current) => {
      if (current.includes(slotId)) return current.filter((id) => id !== slotId);
      if (current.length >= requiredSlots) {
        setMessage(`请选择 ${requiredSlots} 个出勤时段`);
        return current;
      }
      return [...current, slotId];
    });
  }

  async function submitRandomPreference() {
    if (!week || !rider) return;
    if (uniformSlotIds.length !== requiredSlots) {
      setMessage(`请选择 ${requiredSlots} 个统一出勤时段`);
      return;
    }
    setSubmittingKey("random");
    const { data, error } = await supabase.rpc("choose_random_rest_preference", {
      p_rider_id: rider.rider_id,
      p_week_id: week.id,
      p_slot_ids: uniformSlotIds,
    });
    setSubmittingKey(null);
    setConfirmRandom(false);
    const result = data as RpcResult | null;
    if (error || result?.success === false) {
      setMessage(error?.message ?? result?.message ?? "提交失败");
      return;
    }
    await refreshRiderSchedules();
    setMessage("已选择随机排休，等待管理员安排");
  }

  async function submitSpecifiedSchedule() {
    if (!week || !rider) return;
    if (!selectedRestDate) {
      setMessage("请选择一天排休");
      return;
    }
    if (uniformSlotIds.length !== requiredSlots) {
      setMessage(`请选择 ${requiredSlots} 个统一出勤时段`);
      return;
    }

    setSubmittingKey("specified");
    const { data, error } = await supabase.rpc("submit_specified_schedule", {
      p_rider_id: rider.rider_id,
      p_week_id: week.id,
      p_rest_date: selectedRestDate,
      p_slot_ids: uniformSlotIds,
    });
    setSubmittingKey(null);
    setConfirmSpecified(false);
    const result = data as RpcResult | null;
    if (error || result?.success === false) {
      setMessage(error?.message ?? result?.message ?? "提交失败");
      return;
    }
    await refreshRiderSchedules();
    setMessage("指定排休和出勤时段已保存");
  }

  function requestSpecifiedConfirmation() {
    if (!selectedRestDate) {
      setMessage("请选择一天排休");
      return;
    }
    if (uniformSlotIds.length !== requiredSlots) {
      setMessage(`请选择 ${requiredSlots} 个统一出勤时段`);
      return;
    }
    setConfirmSpecified(true);
  }

  if (weekLoading) {
    return (
      <main className="page-container">
        <div className="loading-spinner"><div className="spinner" /><span>加载中...</span></div>
      </main>
    );
  }

  if (!week) {
    return (
      <main className="page-container">
        <header className="page-header"><h1>排班系统</h1><p>该周不存在或尚未发布</p></header>
        <div className="empty-state">请联系管理员获取新的排班链接。</div>
      </main>
    );
  }

  const mode = rider?.rest_preference_mode;
  const specifiedRestDay = weekDays.find((day) => day.key === existingRestDate);
  const selectedRestDay = weekDays.find((day) => day.key === selectedRestDate);
  const hasFixedSubmit = Boolean(
    rider
    && schedulesLoaded
    && !mode
    && (
      draftMode === "random"
      || draftMode === "specified"
    ),
  );
  const noRestQuota = Object.keys(limits).length > 0 && Object.values(limits).every((v) => v === 0);

  return (
    <main className={`page-container employee-page ${hasFixedSubmit ? "with-fixed-submit" : ""}`}>
      {confirmRandom ? (
        <div className="confirm-overlay">
          <section className="confirm-card employee-confirm-card">
            <h3>确认选择随机排休？</h3>
            <p className="confirm-copy">选择随机排休，将随机安排一天休息。提交后不可更改。</p>
            <div className="confirm-actions">
              <button className="btn-secondary" type="button" onClick={() => setConfirmRandom(false)} disabled={submittingKey === "random"}>取消</button>
              <button className="btn-primary" type="button" onClick={submitRandomPreference} disabled={submittingKey === "random"}>
                {submittingKey === "random" ? "提交中..." : "确定提交"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {confirmSpecified ? (
        <div className="confirm-overlay">
          <section className="confirm-card employee-confirm-card">
            <h3>确认提交指定排休？</h3>
            <div className="specified-confirm-summary">
              <div>
                <span>排休日</span>
                <strong>
                  {selectedRestDay?.weekdayLabel ?? "已选择"}
                  {selectedRestDay?.shortDate
                    ? ` · ${selectedRestDay.shortDate}`
                    : ""}
                </strong>
              </div>
              <div>
                <span>出勤时段</span>
                <strong>{uniformSlotIds.map((id) => slotMap[id]?.name).filter(Boolean).join("、")}</strong>
              </div>
            </div>
            <p className="confirm-copy">提交后不可更改。</p>
            <div className="confirm-actions">
              <button className="btn-secondary" type="button" onClick={() => setConfirmSpecified(false)} disabled={submittingKey === "specified"}>取消</button>
              <button className="btn-primary" type="button" onClick={submitSpecifiedSchedule} disabled={submittingKey === "specified"}>
                {submittingKey === "specified" ? "提交中..." : "确定提交"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {showNameGate ? (
        <div className="welcome-overlay">
          <section className="welcome-card">
            <h2>填写姓名</h2>
            <p>请输入骑手名单中的姓名。</p>
            <div className="input-group">
              <input
                className="clean-input"
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void saveEmployeeName(); }}
                placeholder="姓名"
                maxLength={20}
              />
              <button className="btn-primary" type="button" onClick={saveEmployeeName} disabled={submittingKey === "name"}>
                {submittingKey === "name" ? "校验中..." : "确认姓名"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <header className="page-header employee-header">
        <div className="employee-header-line">
          <strong>{rider?.name ?? "排班系统"}</strong>
          <span>·</span>
          <span>{formatWeekRange(week.start_date, week.end_date)}</span>
          {teamName ? <><span>·</span><span className="employee-team-name">{teamName}</span></> : null}
        </div>
        {mode ? <span className={`preference-state ${mode}`}>{mode === "random" ? "随机排休" : "指定排休"}</span> : null}
      </header>

      {message ? <div className="toast-pill">{message}</div> : null}

      {rider && schedulesLoaded && mode === "random" ? (
        <section className="random-result">
          <div className="result-mark">已提交</div>
          <h2>已选择随机排休</h2>
          <p>将随机安排一天休息。</p>
          <div className="random-shift-summary">
            出勤时段：{uniformSlotIds.map((id) => slotMap[id]?.name).filter(Boolean).join("、") || "已提交"}
          </div>
          <div className="submitted-note">已选择随机排休</div>
        </section>
      ) : null}

      {rider && schedulesLoaded && mode === "specified" ? (
        <section className="random-result specified-result">
          <div className="result-mark">已提交</div>
          <h2>已指定排休</h2>
          <div className="specified-result-details">
            <div>
              <span>排休日</span>
              <strong>
                {specifiedRestDay?.weekdayLabel ?? "已选择"}
                {specifiedRestDay?.shortDate
                  ? ` · ${specifiedRestDay.shortDate}`
                  : ""}
              </strong>
            </div>
            <div>
              <span>出勤时段</span>
              <strong>{uniformSlotIds.map((id) => slotMap[id]?.name).filter(Boolean).join("、") || "已选择"}</strong>
            </div>
          </div>
          <div className="submitted-note">排休意愿已确认</div>
        </section>
      ) : null}

      {rider && schedulesLoaded && !mode && !draftMode ? (
        <section className="random-choice-panel">
          <h2>是否随机排休？</h2>
          <p>选择随机排休，随机安排一天休息</p>
          <button className="random-choice-primary" type="button" onClick={() => setDraftMode("random")}>
            选择出勤时段
          </button>
          {!noRestQuota ? (
            <button className="random-choice-secondary" type="button" onClick={() => setDraftMode("specified")}>
              不随机，我要指定排休
            </button>
          ) : null}
        </section>
      ) : null}

      {rider && schedulesLoaded && !mode && draftMode === "random" ? (
        <section className="specified-workflow">
          <div className="workflow-section">
            <div className="section-title-row">
              <div>
                <span className="section-step">1</span>
                <h2>统一出勤时段</h2>
              </div>
              <span className={uniformSlotIds.length === requiredSlots ? "selection-ok" : "selection-count"}>
                {uniformSlotIds.length}/{requiredSlots}
              </span>
            </div>
            <p className="section-help">选择本周统一出勤时段。</p>
            <div className="uniform-slot-grid">
              {selectableSlots.map((slot) => (
                <button
                  key={slot.id}
                  className={`uniform-slot ${uniformSlotIds.includes(slot.id) ? "active" : ""}`}
                  type="button"
                  aria-pressed={uniformSlotIds.includes(slot.id)}
                  onClick={() => toggleUniformSlot(slot.id)}
                >
                  <strong>{slot.name}</strong>
                  <span>{slot.start_time.slice(0, 5)}-{slot.end_time.slice(0, 5)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="fixed-submit-bar">
            <button
              className="btn-primary submit-preference"
              type="button"
              onClick={() => setConfirmRandom(true)}
              disabled={uniformSlotIds.length !== requiredSlots}
            >
              确定提交
            </button>
          </div>
        </section>
      ) : null}

      {rider && schedulesLoaded && !mode && draftMode === "specified" ? (
        <section className="specified-workflow">
          <div className="workflow-section">
            <div className="section-title-row">
              <div>
                <span className="section-step">1</span>
                <h2>统一出勤时段</h2>
              </div>
              <span className={uniformSlotIds.length === requiredSlots ? "selection-ok" : "selection-count"}>
                {uniformSlotIds.length}/{requiredSlots}
              </span>
            </div>
            <p className="section-help">所选时段将应用到除排休日外的每一天。</p>
            <div className="uniform-slot-grid">
              {selectableSlots.map((slot) => (
                <button
                  key={slot.id}
                  className={`uniform-slot ${uniformSlotIds.includes(slot.id) ? "active" : ""}`}
                  type="button"
                  aria-pressed={uniformSlotIds.includes(slot.id)}
                  onClick={() => toggleUniformSlot(slot.id)}
                >
                  <strong>{slot.name}</strong>
                  <span>{slot.start_time.slice(0, 5)} - {slot.end_time.slice(0, 5)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="workflow-section">
            <div className="section-title-row">
              <div>
                <span className="section-step">2</span>
                <h2>指定排休日期</h2>
              </div>
              {selectedRestDate ? <span className="selection-ok">已选择</span> : <span className="selection-count">未选择</span>}
            </div>
            <p className="section-help">名额按你所在的小队单独计算。</p>
            <div className="rest-date-grid">
              {weekDays.map((day) => {
                const ownExistingRest = existingRestDate === day.key ? 1 : 0;
                const remaining = Math.max(
                  0,
                  (limits[day.key] ?? getDefaultLimit(day.key)) - (allRestCounts[day.key] ?? 0) + ownExistingRest,
                );
                const selected = selectedRestDate === day.key;
                const full = remaining <= 0 && !selected;
                return (
                  <button
                    key={day.key}
                    className={`rest-date-option ${selected ? "active" : ""}`}
                    type="button"
                    disabled={full}
                    aria-pressed={selected}
                    onClick={() => setSelectedRestDate(day.key)}
                  >
                    <span>{day.weekdayLabel}</span>
                    <strong>{day.shortDate}</strong>
                    <small className={full ? "full" : ""}>{full ? "名额已满" : `剩余 ${remaining}`}</small>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="fixed-submit-bar">
            <button
              className="btn-primary submit-preference"
              type="button"
              onClick={requestSpecifiedConfirmation}
              disabled={submittingKey === "specified" || !selectedRestDate || uniformSlotIds.length !== requiredSlots}
            >
              {submittingKey === "specified" ? "提交中..." : "确定提交"}
            </button>
          </div>
        </section>
      ) : rider && !schedulesLoaded ? (
        <div className="empty-state">加载排班数据中...</div>
      ) : null}
    </main>
  );
}
