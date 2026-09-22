"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { formatWeekRange } from "@/lib/date";
import { supabase } from "@/lib/supabase";
import type { ExportXlsData, ScheduleWeekRow } from "@/lib/types";

const XLS_TEMPLATE_BUCKET = "xls-templates";
const XLS_MIME_TYPE = "application/vnd.ms-excel";

type HistoryWeek = ScheduleWeekRow & {
  riderCount: number;
  teamCount: number;
  slotCount: number;
};

function todayKey() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("无法读取导出文件"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const separatorIndex = result.indexOf(",");
      if (separatorIndex < 0) {
        reject(new Error("无法转换导出文件"));
        return;
      }
      resolve(result.slice(separatorIndex + 1));
    };
    reader.readAsDataURL(blob);
  });
}

async function removeOriginalFiles(weekIds: string[]) {
  if (weekIds.length === 0) return null;
  const { data, error } = await supabase
    .from("week_import_snapshots")
    .select("original_file_path")
    .in("week_id", weekIds);
  if (error) return error;

  const paths = Array.from(new Set(
    (data ?? [])
      .map((row) => row.original_file_path)
      .filter((path): path is string => Boolean(path)),
  ));
  if (paths.length === 0) return null;

  const { error: storageError } = await supabase.storage.from(XLS_TEMPLATE_BUCKET).remove(paths);
  return storageError;
}

export default function HistoryPage() {
  const router = useRouter();
  const [weeks, setWeeks] = useState<HistoryWeek[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [exportingWeekId, setExportingWeekId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HistoryWeek | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("schedule_weeks")
      .select("*")
      .lt("start_date", todayKey())
      .order("start_date", { ascending: false });

    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as ScheduleWeekRow[];
    const result = await Promise.all(rows.map(async (week) => {
      const [riders, teams, slots] = await Promise.all([
        supabase.from("riders").select("rider_id", { count: "exact", head: true }).eq("week_id", week.id),
        supabase.from("schedule_teams").select("id", { count: "exact", head: true }).eq("week_id", week.id),
        supabase.from("time_slots").select("id", { count: "exact", head: true }).eq("week_id", week.id),
      ]);
      return {
        ...week,
        riderCount: riders.count ?? 0,
        teamCount: teams.count ?? 0,
        slotCount: slots.count ?? 0,
      };
    }));
    setWeeks(result);
    setLoading(false);
  }, []);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  useEffect(() => {
    function closeMenus(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".history-more-actions")) return;
      document.querySelectorAll<HTMLDetailsElement>(".history-more-actions[open]").forEach((menu) => menu.removeAttribute("open"));
    }
    function closeMenusOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      document.querySelectorAll<HTMLDetailsElement>(".history-more-actions[open]").forEach((menu) => menu.removeAttribute("open"));
    }
    document.addEventListener("click", closeMenus);
    document.addEventListener("keydown", closeMenusOnEscape);
    return () => {
      document.removeEventListener("click", closeMenus);
      document.removeEventListener("keydown", closeMenusOnEscape);
    };
  }, []);

  function closeHistoryMenus() {
    document.querySelectorAll<HTMLDetailsElement>(".history-more-actions[open]").forEach((menu) => menu.removeAttribute("open"));
  }

  async function copyScheduleLink(week: HistoryWeek) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/week/${week.id}`);
      setMessage("排班链接已复制");
    } catch {
      setMessage("复制失败，请检查浏览器剪贴板权限");
    }
  }

  async function exportWeek(week: HistoryWeek) {
    setExportingWeekId(week.id);
    setMessage(null);
    try {
      const { data, error } = await supabase.rpc("export_xls_week", { p_week_id: week.id });
      if (error) throw error;
      if (!data) throw new Error("未获取到数据");

      const payload = data as ExportXlsData;
      const toArray = (value: unknown): (string | number | null)[] => (Array.isArray(value) ? value : []);
      const header = toArray(payload.header);
      const slotColSet = new Set(payload.slotColumnIndexes.map((index) => Number(index)));
      const numericIdColSet = new Set(
        header
          .map((cell, index) => ({ label: String(cell ?? "").trim(), index }))
          .filter(({ label }) => label === "管理组ID" || label === "骑手ID")
          .map(({ index }) => index),
      );
      const headerDateIndex = header.findIndex((cell) => String(cell ?? "").trim() === "日期");
      const dateColumnIndex = Number.isInteger(payload.dateColumnIndex)
        ? Number(payload.dateColumnIndex)
        : (headerDateIndex >= 0 ? headerDateIndex : 4);
      const rows = (Array.isArray(payload.rows) ? payload.rows : []).map(toArray);
      const aoa = [header, ...rows].map((row) => row.map((cell, index) => {
        if (cell == null) return "";
        if (slotColSet.has(index) && typeof cell === "string" && (cell === "0" || cell === "1")) return Number(cell);
        if (numericIdColSet.has(index)) {
          const idText = String(cell).trim();
          const idNumber = Number(idText);
          if (/^\d+$/.test(idText) && Number.isSafeInteger(idNumber)) return idNumber;
        }
        if (index === dateColumnIndex) {
          const digits = String(cell).trim().replace(/\D/g, "");
          if (digits.length === 8) return Number(digits);
        }
        return cell;
      }));

      const worksheet = XLSX.utils.aoa_to_sheet(aoa);
      worksheet["!cols"] = header.map((_, index) => {
        if (index === 0) return { wch: 12 };
        if (index === 1) return { wch: 22 };
        if (index === 2) return { wch: 14 };
        if (index === 3) return { wch: 9 };
        if (index === dateColumnIndex) return { wch: 14 };
        if (index < (payload.baseColumns ?? 6)) return { wch: 9 };
        return { wch: 35 };
      });
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "骑手班次");
      const fileName = `${week.name || formatWeekRange(week.start_date, week.end_date)}-排班.xls`;
      const sourceBytes = XLSX.write(workbook, { bookType: "xls", type: "array" }) as ArrayBuffer;
      const fallbackBlob = new Blob([sourceBytes], { type: XLS_MIME_TYPE });

      try {
        const response = await fetch("/api/export-xls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weekId: week.id, fileName, sourceBase64: await blobToBase64(fallbackBlob) }),
        });
        if (!response.ok) throw new Error("兼容文件生成失败");
        downloadBlob(await response.blob(), fileName);
        setMessage("历史排班已导出，可直接上传至排班系统");
      } catch {
        downloadBlob(fallbackBlob, fileName);
        setMessage("历史排班已导出，但不能保证直接上传");
      }
    } catch (err: unknown) {
      setMessage(`导出失败：${err instanceof Error ? err.message : "未知错误"}`);
    } finally {
      setExportingWeekId(null);
    }
  }

  async function deleteWeek(week: HistoryWeek) {
    setWorking(true);
    const fileError = await removeOriginalFiles([week.id]);
    if (fileError) {
      setWorking(false);
      setMessage(`原始 XLS 删除失败：${fileError.message}`);
      return;
    }
    const { error } = await supabase.from("schedule_weeks").delete().eq("id", week.id);
    setWorking(false);
    if (error) { setMessage(error.message); return; }
    setWeeks((current) => current.filter((item) => item.id !== week.id));
    setDeleteTarget(null);
    setMessage("历史排班已删除");
  }

  async function clearHistory() {
    if (weeks.length === 0) return;
    setWorking(true);
    const weekIds = weeks.map((week) => week.id);
    const fileError = await removeOriginalFiles(weekIds);
    if (fileError) {
      setWorking(false);
      setMessage(`原始 XLS 删除失败：${fileError.message}`);
      return;
    }
    const { error } = await supabase.from("schedule_weeks").delete().lt("start_date", todayKey());
    setWorking(false);
    if (error) { setMessage(error.message); return; }
    setWeeks([]);
    setShowClearConfirm(false);
    setMessage("历史排班已清空");
  }

  return (
    <main className="page-container admin-page history-page">
      <header className="page-header">
        <button className="back-link" type="button" onClick={() => router.push("/admin")}>‹ 返回排班管理</button>
        <h1>历史排班</h1>
        <p>开始日期早于今天的排班周 · 可查看、导出或编辑配置</p>
      </header>
      {message ? <div className="toast-pill">{message}</div> : null}
      <section className="admin-section">
        <div className="section-header">
          <div>
            <h2>历史排班记录</h2>
            <p>历史排班数据不可修改，配置项可单独调整；删除后无法恢复</p>
          </div>
          <button className="btn-ghost btn-danger" type="button" disabled={working || weeks.length === 0} onClick={() => setShowClearConfirm(true)}>
            清空历史排班
          </button>
        </div>
        {loading ? (
          <div className="loading-spinner"><div className="spinner" /><span>加载中...</span></div>
        ) : weeks.length === 0 ? (
          <div className="empty-state"><strong>暂无历史排班</strong><span>开始日期早于今天的排班周会自动出现在这里。</span></div>
        ) : (
          <div className="history-list">
            {weeks.map((week) => (
              <article className="history-card" key={week.id}>
                <div className="history-card-main">
                  <strong>{week.name || formatWeekRange(week.start_date, week.end_date)}</strong>
                  <span>{week.start_date} ~ {week.end_date}</span>
                  <div className="history-meta">
                    <span>{week.riderCount} 名骑手</span>
                    <span>{week.teamCount} 个小队</span>
                    <span>{week.slotCount} 个时段</span>
                    <span>{week.show_feedback_entry ? "已开启投诉建议入口" : "未开启投诉建议入口"}</span>
                  </div>
                </div>
                <div className="history-card-actions">
                  <button className="btn-primary btn-sm" type="button" onClick={() => router.push(`/admin/history/${week.id}`)}>查看明细</button>
                  <details className="history-more-actions">
                    <summary>更多操作</summary>
                    <div className="history-more-menu">
                      <button type="button" onClick={() => { closeHistoryMenus(); void copyScheduleLink(week); }}>复制排班链接</button>
                      <button type="button" disabled={exportingWeekId === week.id} onClick={() => { closeHistoryMenus(); void exportWeek(week); }}>
                        {exportingWeekId === week.id ? "导出中..." : "导出历史数据"}
                      </button>
                      <button type="button" onClick={() => { closeHistoryMenus(); router.push(`/admin/${week.id}`); }}>编辑配置</button>
                      <button className="history-more-danger" type="button" disabled={working} onClick={() => { closeHistoryMenus(); setDeleteTarget(week); }}>删除</button>
                    </div>
                  </details>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {deleteTarget ? (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="delete-history-title">
          <div className="confirm-card history-confirm-card">
            <h2 id="delete-history-title">确认删除历史排班</h2>
            <div className="delete-week-target">
              <strong>{deleteTarget.name || "未命名排班周"}</strong>
              <span>{deleteTarget.start_date} ~ {deleteTarget.end_date}</span>
            </div>
            <p className="delete-week-warning">删除后，该周的排班、骑手名单、小队、时段和上传文件都将无法恢复。</p>
            <div className="card-actions-row">
              <button className="btn-ghost" type="button" disabled={working} onClick={() => setDeleteTarget(null)}>取消</button>
              <button className="btn-primary btn-danger" type="button" disabled={working} onClick={() => void deleteWeek(deleteTarget)}>
                {working ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showClearConfirm ? (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="clear-history-title">
          <div className="confirm-card history-confirm-card">
            <h2 id="clear-history-title">确认清空历史排班</h2>
            <div className="delete-week-target">
              <strong>全部历史排班</strong>
              <span>共 {weeks.length} 个排班周</span>
            </div>
            <p className="delete-week-warning">所有开始日期早于今天的排班周都会被删除，删除后无法恢复。</p>
            <div className="card-actions-row">
              <button className="btn-ghost" type="button" disabled={working} onClick={() => setShowClearConfirm(false)}>取消</button>
              <button className="btn-primary btn-danger" type="button" disabled={working} onClick={() => void clearHistory()}>
                {working ? "清空中..." : "确认清空"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
