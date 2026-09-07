"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatWeekRange } from "@/lib/date";
import { supabase } from "@/lib/supabase";
import type { ScheduleWeekRow } from "@/lib/types";

const XLS_TEMPLATE_BUCKET = "xls-templates";

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
  const [message, setMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HistoryWeek | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("schedule_weeks")
      .select("*")
      .lte("start_date", todayKey())
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
    const { error } = await supabase.from("schedule_weeks").delete().lte("start_date", todayKey());
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
        <p>开始日期不晚于今天的排班周 · 仅供预览</p>
      </header>
      {message ? <div className="toast-pill">{message}</div> : null}
      <section className="admin-section">
        <div className="section-header">
          <div>
            <h2>历史排班记录</h2>
            <p>历史记录为只读，删除后无法恢复</p>
          </div>
          <button className="btn-ghost btn-danger" type="button" disabled={working || weeks.length === 0} onClick={() => setShowClearConfirm(true)}>
            清空历史排班
          </button>
        </div>
        {loading ? (
          <div className="loading-spinner"><div className="spinner" /><span>加载中...</span></div>
        ) : weeks.length === 0 ? (
          <div className="empty-state"><strong>暂无历史排班</strong><span>排班周开始后会自动出现在这里。</span></div>
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
                  </div>
                </div>
                <div className="history-card-actions">
                  <button className="btn-primary btn-sm" type="button" onClick={() => router.push(`/admin/history/${week.id}`)}>查看明细</button>
                  <button className="btn-ghost btn-danger btn-sm" type="button" disabled={working} onClick={() => setDeleteTarget(week)}>删除</button>
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
            <p className="delete-week-warning">所有开始日期不晚于今天的排班周都会被删除，删除后无法恢复。</p>
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
