"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { buildDaysFromRange, formatWeekRange, getWeekStart, formatDateKey } from "@/lib/date";
import { supabase } from "@/lib/supabase";
import ImportWeekDialog from "./ImportWeekDialog";
import type {
  ExportXlsData,
  RiderRow,
  RiderScheduleRow,
  ScheduleTeamRow,
  ScheduleWeekRow,
  TimeSlotRow,
} from "@/lib/types";

const DEFAULT_WEEKDAY_LIMIT = 5;
const DEFAULT_WEEKEND_LIMIT = 2;

type BulkActionType = "apply-default" | "apply-slot" | "set-rest" | "clear-rest" | "clear-schedules";
type QuickFilterKey = "random" | "unselected" | "noRest" | "incomplete" | "untouched";
type RiderStatus = {
  hasRest: boolean;
  missingDays: number;
  totalSelected: number;
  totalEntries: number;
  preferenceMode: RiderRow["rest_preference_mode"];
};

const QUICK_FILTER_LABELS: Record<QuickFilterKey, string> = {
  random: "随机待安排",
  unselected: "未选择待安排",
  noRest: "缺排休",
  incomplete: "时段不足",
  untouched: "未生成",
};

function areStringSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function uid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getDefaultLimit(date: string) {
  const day = new Date(`${date}T00:00:00`).getDay();
  return day === 0 || day === 6 ? DEFAULT_WEEKEND_LIMIT : DEFAULT_WEEKDAY_LIMIT;
}

function createDraftWeek(): ScheduleWeekRow {
  const monday = getWeekStart();
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return {
    id: `draft-${uid()}`,
    name: "",
    start_date: formatDateKey(monday),
    end_date: formatDateKey(sunday),
    is_active: true,
    required_slots: 3,
    default_slot_ids: null,
  };
}

export default function AdminPage() {
  const router = useRouter();
  const [weeks, setWeeks] = useState<ScheduleWeekRow[]>([]);
  const [loadingWeeks, setLoadingWeeks] = useState(true);
  const [activeWeek, setActiveWeek] = useState<ScheduleWeekRow | null>(null);
  const [riderMap, setRiderMap] = useState<Record<string, RiderRow>>({});
  const [teams, setTeams] = useState<ScheduleTeamRow[]>([]);
  const [teamCountsByWeek, setTeamCountsByWeek] = useState<Record<string, number>>({});
  const [importedWeekIds, setImportedWeekIds] = useState<Set<string>>(() => new Set());
  const [slots, setSlots] = useState<TimeSlotRow[]>([]);
  const [schedules, setSchedules] = useState<RiderScheduleRow[]>([]);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [message, setMessage] = useState<string | null>(null);

  const [selectedRiderIds, setSelectedRiderIds] = useState<Set<string>>(() => new Set());
  const [quickFilter, setQuickFilter] = useState<QuickFilterKey | null>(null);
  const [bulkRestDate, setBulkRestDate] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<BulkActionType | null>(null);
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [showClearSchedulesConfirm, setShowClearSchedulesConfirm] = useState(false);
  const [completeLoading, setCompleteLoading] = useState(false);

  const [savingWeekId, setSavingWeekId] = useState<string | null>(null);
  const [showPendingOnly, setShowPendingOnly] = useState(false);
  const [applySlotId, setApplySlotId] = useState("");
  const [searchText, setSearchText] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newWeekName, setNewWeekName] = useState("");
  const [newWeekStart, setNewWeekStart] = useState("");
  const [newWeekEnd, setNewWeekEnd] = useState("");
  const [creating, setCreating] = useState(false);
  const [importWeek, setImportWeek] = useState<ScheduleWeekRow | null>(null);
  const [exportingWeekId, setExportingWeekId] = useState<string | null>(null);
  const masterSelectRef = useRef<HTMLInputElement | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  const weekDays = useMemo(() => {
    if (!activeWeek) return [];
    return buildDaysFromRange(activeWeek.start_date, activeWeek.end_date);
  }, [activeWeek]);

  const deleteTargetWeek = useMemo(
    () => weeks.find((week) => week.id === showDeleteConfirm) ?? null,
    [showDeleteConfirm, weeks],
  );

  const weekRiders = useMemo(() => {
    if (!activeWeek) return [];
    // 显示所有导入的骑手，而不仅仅是有排班数据的
    return Object.values(riderMap).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [activeWeek, riderMap]);

  const slotMap = useMemo(() => {
    const map: Record<string, TimeSlotRow> = {};
    for (const slot of slots) map[slot.id] = slot;
    return map;
  }, [slots]);

  const selectableSlotIds = useMemo(() => new Set(slots.filter((s) => s.is_selectable).map((s) => s.id)), [slots]);
  const selectableSlots = useMemo(() => slots.filter((s) => s.is_selectable).sort((a, b) => a.sort_order - b.sort_order), [slots]);

  const namesWithShifts = useMemo(() => new Set(schedules.map((s) => s.rider_id)), [schedules]);

  const scheduleByRider = useMemo(() => {
    const map = new Map<string, Map<string, RiderScheduleRow[]>>();
    for (const entry of schedules) {
      const riderMap = map.get(entry.rider_id) ?? new Map<string, RiderScheduleRow[]>();
      const dayList = riderMap.get(entry.work_date) ?? [];
      dayList.push(entry);
      riderMap.set(entry.work_date, dayList);
      map.set(entry.rider_id, riderMap);
    }
    return map;
  }, [schedules]);

  const riderStatusMap = useMemo<Record<string, RiderStatus>>(() => {
    const result: Record<string, RiderStatus> = {};
    const dayKeys = weekDays.map((day) => day.key);
    for (const rider of weekRiders) {
      const riderDayMap = scheduleByRider.get(rider.rider_id);
      let hasRest = false;
      let missingDays = 0;
      let totalSelected = 0;
      for (const dayKey of dayKeys) {
        const entries = riderDayMap?.get(dayKey) ?? [];
        const restEntry = entries.find((item) => item.slot_id === null);
        if (restEntry) hasRest = true;
        const selectedCount = entries.filter(
          (item) => item.slot_id !== null && item.is_selected && selectableSlotIds.has(item.slot_id),
        ).length;
        totalSelected += selectedCount;
        if (!restEntry && selectedCount < (activeWeek?.required_slots ?? 0)) {
          missingDays += 1;
        }
      }
      result[rider.rider_id] = {
        hasRest,
        missingDays,
        totalSelected,
        totalEntries: dayKeys.length,
        preferenceMode: rider.rest_preference_mode,
      };
    }
    return result;
  }, [activeWeek?.required_slots, scheduleByRider, selectableSlotIds, weekDays, weekRiders]);

  const groups = useMemo(() => {
    return teams.map((team) => ({ id: team.id, name: team.name }));
  }, [teams]);

  const restCounts = useMemo(() => {
    const counts: Record<string, { used: number; limit: number }> = {};
    const visibleTeams = groupFilter
      ? teams.filter((team) => team.id === groupFilter)
      : teams;
    for (const day of weekDays) {
      const used = schedules.filter((schedule) => {
        if (schedule.work_date !== day.key || schedule.slot_id !== null) return false;
        if (!groupFilter) return true;
        return riderMap[schedule.rider_id]?.team_id === groupFilter;
      }).length;
      const limit = visibleTeams.length > 0
        ? visibleTeams.reduce(
          (total, team) => total + (limits[`${team.id}:${day.key}`] ?? getDefaultLimit(day.key)),
          0,
        )
        : getDefaultLimit(day.key);
      counts[day.key] = { used, limit };
    }
    return counts;
  }, [groupFilter, limits, riderMap, schedules, teams, weekDays]);

  const requestSummaries = useMemo(() => {
    const schedulesByRider = new Map<string, RiderScheduleRow[]>();
    for (const schedule of schedules) {
      const list = schedulesByRider.get(schedule.rider_id) ?? [];
      list.push(schedule);
      schedulesByRider.set(schedule.rider_id, list);
    }

    return weekRiders
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
      .map((rider) => {
        const riderSchedules = schedulesByRider.get(rider.rider_id) ?? [];
        const shiftsByDate = new Map<string, RiderScheduleRow[]>();
        for (const schedule of riderSchedules) {
          const list = shiftsByDate.get(schedule.work_date) ?? [];
          list.push(schedule);
          shiftsByDate.set(schedule.work_date, list);
        }

        const dayTexts = weekDays.map((day) => {
          const dayShifts = shiftsByDate.get(day.key);
          if (!dayShifts || dayShifts.length === 0) return `${day.weekdayLabel} 未生成`;

          const restEntry = dayShifts.find((shift) => shift.slot_id === null);
          if (restEntry) return `${day.weekdayLabel} 排休`;

          const selectedSlots = dayShifts
            .filter((shift) => shift.is_selected === true && shift.slot_id !== null)
            .map((shift) => (slotMap[shift.slot_id!] ? slotMap[shift.slot_id!].name : "?"));

          if (selectedSlots.length === 0) return `${day.weekdayLabel} 未选`;

          return `${day.weekdayLabel} ${selectedSlots.join("、")}`;
        });

        return { riderId: rider.rider_id, riderName: rider.name, dayTexts };
      });
  }, [riderMap, schedules, slotMap, weekDays, weekRiders]);

  const riderIdsByFilter = useMemo<Record<QuickFilterKey, string[]>>(() => {
    const result: Record<QuickFilterKey, string[]> = {
      random: [],
      unselected: [],
      noRest: [],
      incomplete: [],
      untouched: [],
    };
    for (const rider of weekRiders) {
      const status = riderStatusMap[rider.rider_id];
      if (!status) continue;
      if (status.preferenceMode === "random" && !status.hasRest) {
        result.random.push(rider.rider_id);
      }
      if (!status.preferenceMode && !status.hasRest) {
        result.unselected.push(rider.rider_id);
      }
      if (!status.hasRest) {
        result.noRest.push(rider.rider_id);
      }
      if (status.missingDays > 0) {
        result.incomplete.push(rider.rider_id);
      }
      if (status.totalSelected === 0 && !status.hasRest) {
        result.untouched.push(rider.rider_id);
      }
    }
    return result;
  }, [weekRiders, riderStatusMap]);

  const filteredRequestSummaries = useMemo(() => {
    let items = requestSummaries;
    if (searchText.trim()) {
      const lower = searchText.toLowerCase();
      items = items.filter((item) => item.riderName.toLowerCase().includes(lower));
    }
    if (groupFilter) {
      items = items.filter((item) => riderMap[item.riderId]?.team_id === groupFilter);
    }
    if (showPendingOnly) {
      items = items.filter((item) => (riderStatusMap[item.riderId]?.missingDays ?? 0) > 0);
    }
    if (quickFilter) {
      const filterIds = new Set(riderIdsByFilter[quickFilter]);
      items = items.filter((item) => filterIds.has(item.riderId));
    }
    return items;
  }, [requestSummaries, searchText, groupFilter, showPendingOnly, quickFilter, riderIdsByFilter, riderMap, riderStatusMap]);

  const applyQuickFilter = useCallback((filter: QuickFilterKey | null) => {
    setQuickFilter((prev) => {
      const nextFilter = prev === filter ? null : filter;
      const targetIds = nextFilter ? riderIdsByFilter[nextFilter] : [];
      setSelectedRiderIds(new Set(targetIds));
      if (masterSelectRef.current) {
        masterSelectRef.current.indeterminate = false;
        masterSelectRef.current.checked = targetIds.length > 0;
      }
      return nextFilter;
    });
  }, [riderIdsByFilter]);

  const toggleRiderSelection = useCallback((riderId: string) => {
    setSelectedRiderIds((prev) => {
      const next = new Set(prev);
      if (next.has(riderId)) {
        next.delete(riderId);
      } else {
        next.add(riderId);
      }
      if (masterSelectRef.current) {
        const totalRows = filteredRequestSummaries.length;
        masterSelectRef.current.checked = next.size === totalRows && totalRows > 0;
        masterSelectRef.current.indeterminate = next.size > 0 && next.size < totalRows;
      }
      return next;
    });
  }, [filteredRequestSummaries.length]);

  const resetSelection = useCallback(() => {
    setSelectedRiderIds(new Set());
    setPendingAction(null);
    if (masterSelectRef.current) {
      masterSelectRef.current.checked = false;
      masterSelectRef.current.indeterminate = false;
    }
  }, []);

  const selectedRiderArray = useMemo(() => Array.from(selectedRiderIds), [selectedRiderIds]);

  useEffect(() => {
    if (!masterSelectRef.current) return;
    const totalRows = filteredRequestSummaries.length;
    masterSelectRef.current.checked = selectedRiderIds.size > 0 && selectedRiderIds.size === totalRows && totalRows > 0;
    masterSelectRef.current.indeterminate = selectedRiderIds.size > 0 && selectedRiderIds.size < totalRows;
  }, [filteredRequestSummaries.length, selectedRiderIds]);

  useEffect(() => {
    setShowAdvancedTools(false);
  }, [activeWeek?.id]);

  const handleBulkAction = useCallback(async (action: BulkActionType) => {
    if (!activeWeek) return;
    const riderIds = Array.from(selectedRiderIds);
    if (riderIds.length === 0) {
      setMessage("请选择至少一位骑手");
      return;
    }
    if (action === "set-rest" && !bulkRestDate) {
      setMessage("请选择排休日期");
      return;
    }
    setBulkLoading(true);
    setMessage(null);
    setPendingAction(action);
    try {
      let responseMessage = "操作已完成";
      if (action === "apply-default") {
        const { error, data } = await supabase.rpc("bulk_apply_default_slots", {
          p_week_id: activeWeek.id,
          p_rider_ids: riderIds,
        });
        if (error) throw error;
        if (data?.processed !== undefined) {
          responseMessage = `已套用默认时段（${data.processed}人）`;
        }
      } else if (action === "apply-slot") {
        if (!applySlotId) { setMessage("请选择要套用的时段"); setBulkLoading(false); setPendingAction(null); return; }
        const { error, data } = await supabase.rpc("bulk_apply_slot", {
          p_week_id: activeWeek.id,
          p_rider_ids: riderIds,
          p_slot_id: applySlotId,
        });
        if (error) throw error;
        const slotName = slotMap[applySlotId]?.name ?? "";
        if (data?.processed !== undefined) {
          responseMessage = `已套用「${slotName}」${data.processed} 条${data.skipped > 0 ? `，跳过 ${data.skipped} 个排休日` : ""}`;
        }
      } else if (action === "set-rest") {
        const { error, data } = await supabase.rpc("bulk_set_rider_rest", {
          p_week_id: activeWeek.id,
          p_rider_ids: riderIds,
          p_work_date: bulkRestDate,
        });
        if (error) throw error;
        if (data?.failed?.length) {
          const successCount = data.processed ?? (riderIds.length - data.failed.length);
          responseMessage = `成功 ${successCount} 人，${data.failed.length} 人未处理（名额不足或已有排休）`;
        } else {
          responseMessage = `已安排排休（${data?.processed ?? riderIds.length}人）`;
        }
      } else if (action === "clear-rest") {
        const { error, data } = await supabase.rpc("bulk_clear_rider_rest", {
          p_week_id: activeWeek.id,
          p_rider_ids: riderIds,
          p_work_date: bulkRestDate || null,
        });
        if (error) throw error;
        if (data?.removed !== undefined) {
          responseMessage = `已取消排休 ${data.removed} 条`;
        }
      } else if (action === "clear-schedules") {
        const { error, data } = await supabase.rpc("bulk_clear_rider_schedules", {
          p_week_id: activeWeek.id,
          p_rider_ids: riderIds,
        });
        if (error) throw error;
        if (data?.removed !== undefined) {
          responseMessage = `已清空排班 ${data.removed} 条`;
        }
      }
      setMessage(responseMessage);
      resetSelection();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "批量操作失败");
    } finally {
      setBulkLoading(false);
      setPendingAction(null);
      setBulkRestDate("");
    }
  }, [activeWeek, bulkRestDate, resetSelection, selectedRiderIds, applySlotId, slotMap]);

  function requestClearSchedules() {
    if (selectedRiderIds.size === 0) {
      setMessage("请选择至少一位骑手");
      return;
    }
    setShowClearSchedulesConfirm(true);
  }

  async function confirmClearSchedules() {
    await handleBulkAction("clear-schedules");
    setShowClearSchedulesConfirm(false);
  }

  function requestCompleteWeek() {
    if (!activeWeek) return;
    if (weekRiders.length === 0) {
      setMessage("当前排班周没有骑手，请先导入数据");
      return;
    }
    const validSlotIds = new Set(selectableSlots.map((slot) => slot.id));
    const validDefaults = (activeWeek.default_slot_ids ?? []).filter((slotId) => validSlotIds.has(slotId));
    if ((activeWeek.required_slots ?? 0) > validDefaults.length) {
      setMessage("默认时段不足，请先到“编辑配置”中设置足够的默认时段");
      return;
    }
    setShowCompleteConfirm(true);
  }

  async function handleCompleteWeek() {
    if (!activeWeek || completeLoading) return;
    setCompleteLoading(true);
    setMessage(null);
    const { data, error } = await supabase.rpc("complete_week_schedules", {
      p_week_id: activeWeek.id,
    });
    setCompleteLoading(false);
    setShowCompleteConfirm(false);

    if (error || data?.success === false) {
      setMessage(error?.message ?? data?.message ?? "自动补全排班失败");
      return;
    }

    const { data: latestSchedules } = await supabase
      .from("rider_schedules")
      .select("*")
      .eq("week_id", activeWeek.id);
    if (latestSchedules) setSchedules(latestSchedules);

    const unassigned = Number(data?.restUnassigned ?? 0);
    const summary = `已安排排休 ${Number(data?.restAssigned ?? 0)} 人，补充 ${Number(data?.slotsAdded ?? 0)} 个时段`;
    setMessage(unassigned > 0 ? `${summary}；仍有 ${unassigned} 人因名额不足未安排排休` : summary);
  }

  async function handleXlsExport(week: ScheduleWeekRow) {
    setExportingWeekId(week.id);
    setMessage(null);
    try {
      const { data, error } = await supabase.rpc("export_xls_week", { p_week_id: week.id });
      if (error) {
        setMessage(`导出失败：${error.message}`);
        return;
      }
      if (!data) {
        setMessage("导出失败：未获取到数据");
        return;
      }

      const payload = data as ExportXlsData;
      const toArray = (value: unknown): (string | number | null)[] => (Array.isArray(value) ? value : []);
      const header = toArray(payload.header);
      const slotColSet = new Set(payload.slotColumnIndexes.map((index) => Number(index)));
      const headerDateIndex = header.findIndex((cell) => String(cell ?? "").trim() === "日期");
      const dateColumnIndex = Number.isInteger(payload.dateColumnIndex)
        ? Number(payload.dateColumnIndex)
        : (headerDateIndex >= 0 ? headerDateIndex : 4);
      const rows = (Array.isArray(payload.rows) ? payload.rows : []).map(toArray);
      const aoa = [header, ...rows].map((row) =>
        row.map((cell, ci) => {
          if (cell == null) return "";
          if (slotColSet.has(ci) && typeof cell === "string" && (cell === "0" || cell === "1")) return Number(cell);
          if (ci === dateColumnIndex) {
            const digits = String(cell).trim().replace(/\D/g, "");
            if (digits.length === 8) {
              const year = Number(digits.slice(0, 4));
              const month = Number(digits.slice(4, 6));
              const day = Number(digits.slice(6, 8));
              return Date.UTC(year, month - 1, day) / 86400000 + 25569;
            }
          }
          return cell;
        })
      );

      const worksheet = XLSX.utils.aoa_to_sheet(aoa);
      for (let rowIndex = 1; rowIndex < aoa.length; rowIndex += 1) {
        const address = XLSX.utils.encode_cell({ r: rowIndex, c: dateColumnIndex });
        if (worksheet[address]?.t === "n") {
          worksheet[address].z = "yyyy-mm-dd";
        }
      }
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "排班数据");

      const fileName = `${week.name || formatWeekRange(week.start_date, week.end_date)}-排班.xls`;
      XLSX.writeFile(workbook, fileName, { bookType: 'xls' });
      setMessage(payload.generated ? "导出成功（基于当前排班生成）" : "导出成功（保持导入模板结构）");
    } catch (err: unknown) {
      setMessage(`导出失败：${err instanceof Error ? err.message : "未知错误"}`);
    } finally {
      setExportingWeekId(null);
    }
  }

  useEffect(() => {
    async function load() {
      setLoadingWeeks(true);
      const [weeksRes, teamsRes, snapshotsRes] = await Promise.all([
        supabase.from("schedule_weeks").select("*").order("created_at", { ascending: false }),
        supabase.from("schedule_teams").select("week_id"),
        supabase.from("week_import_snapshots").select("week_id"),
      ]);
      if (weeksRes.data) {
        setWeeks(weeksRes.data);
        const savedWeekId = typeof window !== "undefined" ? localStorage.getItem("admin-selected-week-id") : null;
        const savedWeek = savedWeekId ? weeksRes.data.find((w) => w.id === savedWeekId) : null;
        setActiveWeek(savedWeek ?? weeksRes.data.find((w) => w.is_active) ?? weeksRes.data[0] ?? null);
      }
      if (teamsRes.data) {
        setTeamCountsByWeek(teamsRes.data.reduce<Record<string, number>>((counts, team) => {
          counts[team.week_id] = (counts[team.week_id] ?? 0) + 1;
          return counts;
        }, {}));
      }
      if (snapshotsRes.data) {
        setImportedWeekIds(new Set(snapshotsRes.data.map((snapshot) => snapshot.week_id)));
      }
      setLoadingWeeks(false);
    }
    void load();
  }, []);

  useEffect(() => {
    if (!activeWeek) { setSlots([]); setSchedules([]); setLimits({}); setRiderMap({}); setTeams([]); return; }
    const curWeek = activeWeek;
    async function loadWeek() {
      const [slotsRes, schedulesRes, limitsRes, ridersRes, teamsRes] = await Promise.all([
        supabase.from("time_slots").select("*").eq("week_id", curWeek.id).order("sort_order"),
        supabase.from("rider_schedules").select("*").eq("week_id", curWeek.id),
        supabase.from("rest_day_limits").select("team_id,rest_date,max_slots").eq("week_id", curWeek.id),
        supabase.from("riders").select("*").eq("week_id", curWeek.id),
        supabase.from("schedule_teams").select("*").eq("week_id", curWeek.id).order("name"),
      ]);
      if (slotsRes.data) setSlots(slotsRes.data);
      if (schedulesRes.data) setSchedules(schedulesRes.data);
      if (limitsRes.data) {
        setLimits(limitsRes.data.reduce<Record<string, number>>((acc, row) => {
          acc[`${row.team_id}:${row.rest_date}`] = row.max_slots;
          return acc;
        }, {}));
      }
      if (ridersRes.data) {
        setRiderMap(ridersRes.data.reduce<Record<string, RiderRow>>((acc, r) => { acc[r.rider_id] = r; return acc; }, {}));
      }
      if (teamsRes.data) setTeams(teamsRes.data);
    }
    void loadWeek();
  }, [activeWeek]);

  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(() => setMessage(null), 2500);
    return () => window.clearTimeout(t);
  }, [message]);

  useEffect(() => {
    const channel = supabase
      .channel(`admin-sync-${activeWeek?.id ?? "none"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "schedule_weeks" }, async () => {
        const { data } = await supabase.from("schedule_weeks").select("*").order("created_at", { ascending: false });
        if (data) {
          setWeeks(data);
          setActiveWeek((cur) => data.find((w) => w.id === cur?.id) ?? data.find((w) => w.is_active) ?? data[0] ?? null);
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "time_slots" }, async () => {
        if (!activeWeek) return;
        const { data } = await supabase.from("time_slots").select("*").eq("week_id", activeWeek.id).order("sort_order");
        if (data) setSlots(data);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "rider_schedules", filter: activeWeek ? `week_id=eq.${activeWeek.id}` : undefined }, async () => {
        if (!activeWeek) return;
        const { data } = await supabase.from("rider_schedules").select("*").eq("week_id", activeWeek.id);
        if (data) setSchedules(data);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "rest_day_limits", filter: activeWeek ? `week_id=eq.${activeWeek.id}` : undefined }, async () => {
        if (!activeWeek) return;
        const { data } = await supabase.from("rest_day_limits").select("team_id,rest_date,max_slots").eq("week_id", activeWeek.id);
        if (data) setLimits(data.reduce<Record<string, number>>((acc, row) => {
          acc[`${row.team_id}:${row.rest_date}`] = row.max_slots;
          return acc;
        }, {}));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "riders", filter: activeWeek ? `week_id=eq.${activeWeek.id}` : undefined }, async () => {
        if (!activeWeek) return;
        const { data } = await supabase.from("riders").select("*").eq("week_id", activeWeek.id);
        if (data) setRiderMap(data.reduce<Record<string, RiderRow>>((acc, r) => { acc[r.rider_id] = r; return acc; }, {}));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "schedule_teams", filter: activeWeek ? `week_id=eq.${activeWeek.id}` : undefined }, async () => {
        if (!activeWeek) return;
        const { data } = await supabase.from("schedule_teams").select("*").eq("week_id", activeWeek.id).order("name");
        if (data) {
          setTeams(data);
          setTeamCountsByWeek((current) => ({ ...current, [activeWeek.id]: data.length }));
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "week_import_snapshots" }, async () => {
        const { data } = await supabase.from("week_import_snapshots").select("week_id");
        if (data) setImportedWeekIds(new Set(data.map((snapshot) => snapshot.week_id)));
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [activeWeek]);

  async function saveWeek(week: ScheduleWeekRow) {
    if (!week.start_date || !week.end_date) { setMessage("请完整填写起止日期。"); return; }
    setSavingWeekId(week.id);
    setMessage(null);
    const isDraft = week.id.startsWith("draft-");
    const payload = {
      ...(isDraft ? {} : { id: week.id }),
      start_date: week.start_date,
      end_date: week.end_date,
      is_active: week.is_active,
      required_slots: week.required_slots ?? 3,
      default_slot_ids: week.default_slot_ids,
    };
    const { data, error } = await supabase.from("schedule_weeks").upsert(payload).select("id").single();
    if (error) { setSavingWeekId(null); setMessage(error.message); return; }
    const newWeekId = data?.id ?? week.id;

    if (isDraft) {
      const sourceWeek = weeks.filter((w) => !w.id.startsWith("draft-")).sort((a, b) => b.end_date.localeCompare(a.end_date))[0];
      if (sourceWeek) {
        const { data: hasSlots } = await supabase.from("time_slots").select("id").eq("week_id", sourceWeek.id).limit(1).maybeSingle();
        if (hasSlots) {
          await supabase.rpc("clone_week_slots", { p_source_week_id: sourceWeek.id, p_target_week_id: newWeekId });
        }
      }
      setWeeks((cur) => cur.filter((w) => w.id !== week.id));
    }

    setSavingWeekId(null);
    setMessage("排休周已保存。");
  }

  async function deleteWeek(weekId: string) {
    setSavingWeekId(weekId);
    setMessage(null);
    if (weekId.startsWith("draft-")) {
      const remainingWeeks = weeks.filter((week) => week.id !== weekId);
      setWeeks(remainingWeeks);
      if (activeWeek?.id === weekId) {
        const nextWeek = remainingWeeks.find((week) => week.is_active) ?? remainingWeeks[0] ?? null;
        setActiveWeek(nextWeek);
        if (nextWeek) localStorage.setItem("admin-selected-week-id", nextWeek.id);
        else localStorage.removeItem("admin-selected-week-id");
      }
      setSavingWeekId(null);
      setShowDeleteConfirm(null);
      return;
    }
    await supabase.from("rest_day_limits").delete().eq("week_id", weekId);
    const { error } = await supabase.from("schedule_weeks").delete().eq("id", weekId);
    setSavingWeekId(null);
    if (error) { setMessage(error.message); return; }
    const remainingWeeks = weeks.filter((week) => week.id !== weekId);
    setWeeks(remainingWeeks);
    setImportedWeekIds((current) => {
      const next = new Set(current);
      next.delete(weekId);
      return next;
    });
    setTeamCountsByWeek((current) => {
      const next = { ...current };
      delete next[weekId];
      return next;
    });
    if (activeWeek?.id === weekId) {
      const nextWeek = remainingWeeks.find((week) => week.is_active) ?? remainingWeeks[0] ?? null;
      setActiveWeek(nextWeek);
      if (nextWeek) localStorage.setItem("admin-selected-week-id", nextWeek.id);
      else localStorage.removeItem("admin-selected-week-id");
    }
    setShowDeleteConfirm(null);
    setMessage("排休周已删除。");
  }

  async function handleCreateWeek() {
    if (!newWeekName.trim() || !newWeekStart || !newWeekEnd) {
      setMessage("请填写完整的名称和日期");
      return;
    }
    setCreating(true);
    setMessage(null);
    const { data, error } = await supabase.from("schedule_weeks").insert({
      name: newWeekName.trim(),
      start_date: newWeekStart,
      end_date: newWeekEnd,
      is_active: true,
      required_slots: 3,
    }).select().single();
    setCreating(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    if (data) {
      setWeeks((cur) => [data, ...cur]);
      setShowCreateModal(false);
      setNewWeekName("");
      setNewWeekStart("");
      setNewWeekEnd("");
      setMessage("排休周已创建，点击编辑配置进行详细设置");
    }
  }

  return (
    <main className="page-container admin-page">
      {importWeek ? (
        <ImportWeekDialog
          week={importWeek}
          onClose={() => setImportWeek(null)}
          onImported={(importMessage) => {
            setMessage(importMessage);
            setImportedWeekIds((current) => new Set(current).add(importWeek.id));
            setImportWeek(null);
            if (activeWeek?.id === importWeek.id) {
              setActiveWeek({ ...activeWeek });
            }
          }}
        />
      ) : null}
      {exportingWeekId ? (
        <div className="export-overlay" role="dialog" aria-modal="true" aria-labelledby="export-progress-title">
          <div className="export-progress">
            <div className="spinner" aria-hidden="true" />
            <strong id="export-progress-title">正在导出 XLS</strong>
            <span>正在整理排班数据并生成文件，请稍候</span>
          </div>
        </div>
      ) : null}
      <header className="page-header">
        <h1>后台管理</h1>
        <p>排班周管理 · 排班总览</p>
      </header>
      {message ? <div className="toast-pill">{message}</div> : null}

      {/* 排班周配置 */}
      <section className="admin-section">
        <div className="section-header">
          <div>
            <h2>排班周配置</h2>
            <p>点击卡片切换排班总览</p>
          </div>
          <button className="btn-primary btn-sm" type="button" onClick={() => setShowCreateModal(true)}>+ 新增一周</button>
        </div>
        {loadingWeeks ? (
          <div className="empty-state">加载中...</div>
        ) : (
          <div className="config-grid">
            {weeks.map((week) => (
              <div
                className={`config-card week-config-card ${activeWeek?.id === week.id ? "active-card" : ""}`}
                key={week.id}
                style={{ position: "relative", cursor: "pointer" }}
                onClick={(e) => {
                  if (!(e.target as HTMLElement).closest("button") && !(e.target as HTMLElement).closest("input")) {
                    setActiveWeek(week);
                    localStorage.setItem("admin-selected-week-id", week.id);
                  }
                }}
              >
                <button
                  className="btn-ghost btn-danger"
                  type="button"
                  style={{ position: "absolute", top: "12px", right: "12px", padding: "4px 8px", fontSize: "12px" }}
                  disabled={savingWeekId === week.id}
                  onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(week.id); }}
                >
                  删除
                </button>
                <div className="input-group" style={{ paddingRight: "32px" }}>
                  <strong style={{ fontSize: "16px" }}>{week.name || formatWeekRange(week.start_date, week.end_date)}</strong>
                  <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                    {week.start_date} ~ {week.end_date}
                  </span>
                  <span className="week-meta-line">
                    {teamCountsByWeek[week.id] ?? 1} 个小队
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px" }}>
                  <span style={{ fontSize: "12px", color: "var(--text-muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {typeof window !== "undefined" ? `${window.location.origin}/week/${week.id}` : `/week/${week.id}`}
                  </span>
                  <button
                    className="btn-ghost"
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(`${window.location.origin}/week/${week.id}`); setMessage("链接已复制"); }}
                    style={{ padding: "4px 8px", border: "1px solid var(--border-color)", fontSize: "12px", color: "var(--text-muted)" }}
                    title="复制"
                  >
                    复制
                  </button>
                </div>
                <div className="week-card-actions">
                  <button
                    className="btn-primary btn-sm"
                    type="button"
                    onClick={(e) => { e.stopPropagation(); router.push(`/admin/${week.id}`); }}
                  >
                    编辑配置
                  </button>
                  {importedWeekIds.has(week.id) ? (
                    <button
                      className="btn-ghost btn-sm"
                      type="button"
                      disabled={exportingWeekId === week.id}
                      onClick={(e) => { e.stopPropagation(); void handleXlsExport(week); }}
                    >
                      {exportingWeekId === week.id ? "导出中..." : "导出 XLS"}
                    </button>
                  ) : (
                    <button
                      className="btn-ghost btn-sm"
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setImportWeek(week); }}
                    >
                      导入数据
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 排班总览 */}
      {activeWeek ? (
        <section className="admin-section">
          <div className="section-header">
            <div>
              <h2>排班总览</h2>
              <p>{activeWeek ? formatWeekRange(activeWeek.start_date, activeWeek.end_date) : "未选择周"} · 总人数 {weekRiders.length} · 已排班 {namesWithShifts.size}</p>
            </div>
          </div>
          {weekRiders.length > 0 ? (
            <>
              <div className="member-tags">
                {weekRiders.map((r) => (
                  <span key={r.rider_id} className={`member-tag ${namesWithShifts.has(r.rider_id) ? "" : "member-tag-pending"}`}>
                    {r.name}
                  </span>
                ))}
              </div>
            </>
          ) : <p style={{ fontSize: "14px", color: "var(--text-muted)" }}>暂无骑手名单，请导入 XLS</p>}

          {requestSummaries.length > 0 ? (
            <>
              <div className={`bulk-panel ${showAdvancedTools ? "expanded" : "collapsed"}`}>
                <div className="bulk-panel-top">
                  <div className="selection-meta">
                    <div>
                      <strong>{selectedRiderArray.length}</strong> / {filteredRequestSummaries.length} 已选
                    </div>
                    {quickFilter ? (
                      <button
                        className="chip chip-active"
                        type="button"
                        onClick={() => applyQuickFilter(quickFilter)}
                      >
                        {QUICK_FILTER_LABELS[quickFilter]}
                      </button>
                    ) : null}
                    <button className="btn-secondary btn-sm" type="button" onClick={resetSelection} disabled={selectedRiderArray.length === 0}>清除选择</button>
                  </div>
                  <div className="filter-chips">
                    {([
                      { key: "random", label: "随机待安排" },
                      { key: "unselected", label: "未选择待安排" },
                      { key: "noRest", label: "缺排休" },
                      { key: "incomplete", label: "时段不足" },
                      { key: "untouched", label: "未生成" },
                    ] as { key: QuickFilterKey; label: string }[]).map(({ key, label }) => (
                      <button
                        key={key}
                        className={`chip ${quickFilter === key ? "chip-active" : ""}`}
                        type="button"
                        onClick={() => applyQuickFilter(key)}
                      >
                        {label}
                        <small style={{ opacity: 0.6 }}>（{riderIdsByFilter[key].length}）</small>
                      </button>
                    ))}
                    <button
                      className={`chip ${showPendingOnly ? "chip-active" : ""}`}
                      type="button"
                      onClick={() => setShowPendingOnly((prev) => !prev)}
                    >
                      未完成排班
                      <small style={{ opacity: 0.6 }}>（{weekRiders.filter((r) => {
                        const status = riderStatusMap[r.rider_id];
                        return !status || status.missingDays > 0;
                      }).length}）</small>
                    </button>
                  </div>
                  <div className="admin-tools-actions">
                    <button
                      className="btn-primary btn-sm"
                      type="button"
                      onClick={requestCompleteWeek}
                      disabled={completeLoading}
                    >
                      {completeLoading ? "处理中..." : "自动补全排班"}
                    </button>
                    <button
                      className="btn-secondary btn-sm"
                      type="button"
                      aria-expanded={showAdvancedTools}
                      onClick={() => setShowAdvancedTools((current) => !current)}
                    >
                      {showAdvancedTools ? "收起" : "展开更多"}
                    </button>
                  </div>
                </div>

                <div className="filter-bar">
                  <input
                    className="filter-input"
                    type="text"
                    placeholder="搜索骑手姓名..."
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                  />
                  <select
                    className="filter-select"
                    value={groupFilter}
                    onChange={(e) => setGroupFilter(e.target.value)}
                  >
                    <option value="">全部组别</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                  {(searchText || groupFilter || showPendingOnly || quickFilter) ? (
                    <button className="btn-ghost btn-sm" type="button" onClick={() => { setSearchText(""); setGroupFilter(""); setShowPendingOnly(false); setQuickFilter(null); }}>
                      清除筛选
                    </button>
                  ) : null}
                  <span style={{ fontSize: "13px", color: "var(--text-muted)", marginLeft: "auto", whiteSpace: "nowrap" }}>
                    筛选 {filteredRequestSummaries.length}/{requestSummaries.length} 人
                  </span>
                </div>

                <div className="bulk-actions-grid">
                  <div className="bulk-action-card">
                    <div>
                      <h4>套用指定时段</h4>
                      <p>选择单个时段套用到选中骑手的非排休日</p>
                    </div>
                    {selectableSlots.length > 0 && (
                      <div className="inline-input" style={{ flexWrap: "wrap" }}>
                        {selectableSlots.map((slot) => (
                          <button
                            key={slot.id}
                            className={`chip ${applySlotId === slot.id ? "chip-active" : ""}`}
                            type="button"
                            onClick={() => setApplySlotId(applySlotId === slot.id ? "" : slot.id)}
                          >
                            {slot.name}
                          </button>
                        ))}
                      </div>
                    )}
                    <footer>
                      <div className="bulk-meta">{applySlotId ? `已选：${slotMap[applySlotId]?.name ?? ""}` : "请选择时段"}</div>
                      <button
                        className="btn-primary btn-sm"
                        type="button"
                        onClick={() => void handleBulkAction("apply-slot")}
                        disabled={bulkLoading || !applySlotId}
                      >
                        {pendingAction === "apply-slot" ? "处理中..." : "套用"}
                      </button>
                    </footer>
                  </div>
                  <div className="bulk-action-card">
                    <div>
                      <h4>批量设为排休</h4>
                      <p>指定日期，一键为选中骑手安排排休</p>
                    </div>
                    <div className="inline-input">
                      <input type="date" value={bulkRestDate} onChange={(e) => setBulkRestDate(e.target.value)} />
                      <span className="bulk-note">先选择日期再执行</span>
                    </div>
                    <footer>
                      <div className="bulk-meta">名额会自动校验</div>
                      <button
                        className="btn-primary btn-sm"
                        type="button"
                        onClick={() => void handleBulkAction("set-rest")}
                        disabled={bulkLoading || !bulkRestDate}
                      >
                        {pendingAction === "set-rest" ? "处理中..." : "安排排休"}
                      </button>
                    </footer>
                  </div>
                  <div className="bulk-action-card">
                    <div>
                      <h4>取消排休</h4>
                      <p>清除选中骑手的排休记录，可选特定日期或整周</p>
                    </div>
                    <div className="inline-input">
                      <input type="date" value={bulkRestDate} onChange={(e) => setBulkRestDate(e.target.value)} placeholder="可选" />
                      <span className="bulk-note">留空 = 清除整周排休</span>
                    </div>
                    <footer>
                      <div className="bulk-meta">批量快速恢复出勤</div>
                      <button
                        className="btn-secondary btn-sm"
                        type="button"
                        onClick={() => void handleBulkAction("clear-rest")}
                        disabled={bulkLoading}
                      >
                        {pendingAction === "clear-rest" ? "处理中..." : "取消排休"}
                      </button>
                    </footer>
                  </div>
                  <div className="bulk-action-card">
                    <div>
                      <h4>清空排班</h4>
                      <p>移除选中骑手本周所有排班记录</p>
                    </div>
                    <footer>
                      <div className="bulk-meta">支持重新分配</div>
                      <button
                        className="btn-secondary btn-sm"
                        type="button"
                        onClick={requestClearSchedules}
                        disabled={bulkLoading}
                      >
                        {pendingAction === "clear-schedules" ? "处理中..." : "清空排班"}
                      </button>
                    </footer>
                  </div>
                </div>
              </div>

              {filteredRequestSummaries.length > 0 ? (
              <div className="table-wrapper">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th style={{ width: "44px" }}>
                        <input
                          ref={masterSelectRef}
                          type="checkbox"
                          onChange={(e) => {
                            if (e.target.checked) {
                              const allIds = filteredRequestSummaries.map((item) => item.riderId);
                              setSelectedRiderIds(new Set(allIds));
                            } else {
                              resetSelection();
                            }
                          }}
                        />
                      </th>
                      <th>骑手 ({filteredRequestSummaries.length}人)</th>
                      {weekDays.map((day) => {
                      const rc = restCounts[day.key] ?? { used: 0, limit: 0 };
                      const full = rc.used >= rc.limit;
                      return (
                        <th key={day.key}>
                          {day.weekdayLabel}<br />
                          <span style={{ fontWeight: "normal", fontSize: "12px" }}>{day.shortDate}</span><br />
                          <span style={{ fontWeight: "normal", fontSize: "11px", color: full ? "#ef4444" : "var(--text-muted)" }}>
                            休息日：{rc.used}/{rc.limit}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filteredRequestSummaries.map((item) => {
                    const status = riderStatusMap[item.riderId];
                    const isSelected = selectedRiderIds.has(item.riderId);
                    return (
                      <tr key={item.riderId} style={isSelected ? { background: "rgba(245, 158, 11, 0.08)" } : undefined}>
                        <td>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRiderSelection(item.riderId)}
                          />
                        </td>
                        <td style={{ textAlign: "left" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            <span style={{ fontWeight: 600 }}>{item.riderName}</span>
                            <span className="rider-team-label">
                              {teams.find((team) => team.id === riderMap[item.riderId]?.team_id)?.name ?? "默认小队"}
                            </span>
                            {status ? (
                              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                                {status.preferenceMode === "random"
                                  ? status.hasRest ? "随机排休 · 已安排" : "随机排休 · 待安排"
                                  : status.preferenceMode === "specified"
                                    ? "指定排休"
                                    : "尚未选择"}
                                {" · "}
                                {status.hasRest ? "已有排休" : "缺排休"}
                                {" · "}
                                {status.totalSelected}/{status.totalEntries * (activeWeek?.required_slots ?? 0)} 时段
                              </span>
                            ) : null}
                          </div>
                        </td>
                        {item.dayTexts.map((text, i) => {
                          const state = text.substring(text.indexOf(" ") + 1);
                          let cls = "work";
                          if (state === "排休") cls = "rest";
                          if (state === "未生成" || state === "未选") cls = "missing";
                          return (
                            <td key={i}>
                              {cls === "work" ? (
                                <div className="shift-badges" title={state}>
                                  {state.split("、").map((slotName, slotIndex) => (
                                    <span className="status-badge work" key={`${slotName}-${slotIndex}`}>{slotName}</span>
                                  ))}
                                </div>
                              ) : (
                                <span className={`status-badge ${cls}`}>{state}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">未找到匹配的骑手</div>
            )}
            </>
          ) : null}
        </section>
      ) : null}

      {showCompleteConfirm && (
        <div className="overlay" onClick={() => { if (!completeLoading) setShowCompleteConfirm(false); }}>
          <div className="confirm-card" onClick={(event) => event.stopPropagation()}>
            <h2>确认自动补全排班</h2>
            <p className="complete-confirm-copy">
              系统将保留已有选择，用默认时段补足每天缺少的数量，并按各小队剩余名额为所有缺少排休的骑手自动安排休息日。
            </p>
            <div className="card-actions-row">
              <button className="btn-ghost" type="button" onClick={() => setShowCompleteConfirm(false)} disabled={completeLoading}>取消</button>
              <button className="btn-primary" type="button" onClick={() => void handleCompleteWeek()} disabled={completeLoading}>
                {completeLoading ? "处理中..." : "确认补全"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showClearSchedulesConfirm && (
        <div
          className="overlay"
          onClick={() => {
            if (!bulkLoading) setShowClearSchedulesConfirm(false);
          }}
        >
          <div className="confirm-card" onClick={(event) => event.stopPropagation()}>
            <h2>确认清空排班</h2>
            <p className="complete-confirm-copy">
              确定清空已选 {selectedRiderIds.size} 位骑手的本周排班吗？排休和出勤时段都将被删除，且无法撤销。
            </p>
            <div className="card-actions-row">
              <button
                className="btn-ghost"
                type="button"
                onClick={() => setShowClearSchedulesConfirm(false)}
                disabled={bulkLoading}
              >
                取消
              </button>
              <button
                className="btn-primary btn-danger"
                type="button"
                onClick={() => void confirmClearSchedules()}
                disabled={bulkLoading}
              >
                {pendingAction === "clear-schedules" ? "清空中..." : "确认清空"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认弹窗 */}
      {showDeleteConfirm && (
        <div
          className="overlay"
          onClick={() => {
            if (savingWeekId !== showDeleteConfirm) setShowDeleteConfirm(null);
          }}
        >
          <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
            <h2>确认删除</h2>
            <div className="delete-week-target">
              <strong>{deleteTargetWeek?.name.trim() || "未命名排班周"}</strong>
              {deleteTargetWeek ? (
                <span>{deleteTargetWeek.start_date} ~ {deleteTargetWeek.end_date}</span>
              ) : null}
            </div>
            <p className="delete-week-warning">删除后将无法恢复，确定要删除这个排班周吗？</p>
            <div className="card-actions-row">
              <button
                className="btn-ghost"
                type="button"
                onClick={() => setShowDeleteConfirm(null)}
                disabled={savingWeekId === showDeleteConfirm}
              >
                取消
              </button>
              <button
                className="btn-primary btn-danger"
                type="button"
                onClick={() => deleteWeek(showDeleteConfirm)}
                disabled={savingWeekId === showDeleteConfirm}
              >
                {savingWeekId === showDeleteConfirm ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 创建周弹窗 */}
      {showCreateModal && (
        <div className="overlay" onClick={() => setShowCreateModal(false)}>
          <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
            <h2>创建排班周</h2>
            <div className="input-group">
              <label>排班名称</label>
              <input
                className="clean-input"
                type="text"
                value={newWeekName}
                onChange={(e) => setNewWeekName(e.target.value)}
                placeholder="例如：第一周、A队排班等"
                autoFocus
              />
            </div>
            <div className="input-group">
              <label>开始日期</label>
              <input
                className="clean-input"
                type="date"
                value={newWeekStart}
                onChange={(e) => setNewWeekStart(e.target.value)}
              />
            </div>
            <div className="input-group">
              <label>结束日期</label>
              <input
                className="clean-input"
                type="date"
                value={newWeekEnd}
                onChange={(e) => setNewWeekEnd(e.target.value)}
              />
            </div>
            <div className="card-actions-row" style={{ marginTop: "16px" }}>
              <button className="btn-ghost" type="button" onClick={() => setShowCreateModal(false)}>取消</button>
              <button className="btn-primary" type="button" onClick={handleCreateWeek} disabled={creating}>
                {creating ? "创建中..." : "创建"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
