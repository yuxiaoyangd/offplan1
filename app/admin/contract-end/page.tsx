"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { DEFAULT_CONTRACT_END_REASONS, validContractEndReasons, type ContractEndFormRow, type ContractEndReasonOption, type SelectedContractEndReason } from "@/lib/contract-end";
import styles from "./page.module.css";

type SubmissionRow = {
  id: string;
  rider_name: string;
  satisfaction: number;
  selected_reasons: SelectedContractEndReason[];
  details: string | null;
  created_at: string;
};

const SUBMISSION_PAGE_SIZE = 500;
const SUBMISSION_HEADERS = ["提交日期", "提交时间", "姓名", "满意度", "断签原因", "其他原因说明"];
const submissionDateFormat = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  dateStyle: "long",
});
const submissionTimeFormat = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function ReasonEditor({ reasons, onChange }: {
  reasons: ContractEndReasonOption[];
  onChange: (reasons: ContractEndReasonOption[]) => void;
}) {
  function change(id: string, patch: Partial<ContractEndReasonOption>) {
    onChange(reasons.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  return (
    <div className={styles.reasonEditor}>
      <div className={styles.reasonEditorHeading}>
        <strong>断签原因</strong>
        <button className={styles.textButton} type="button" disabled={reasons.length >= 20} onClick={() => onChange([...reasons, { id: crypto.randomUUID(), label: "", requiresDetails: false }])}>+ 添加原因</button>
      </div>
      {reasons.map((reason) => (
        <div className={styles.reasonEditRow} key={reason.id}>
          <input aria-label="原因名称" value={reason.label} maxLength={80} placeholder="原因名称" onChange={(event) => change(reason.id, { label: event.target.value, requiresDetails: event.target.value.trim() === "其他原因" })} />
          <button className={styles.removeReason} type="button" disabled={reasons.length === 1} onClick={() => onChange(reasons.filter((item) => item.id !== reason.id))}>删除</button>
        </div>
      ))}
    </div>
  );
}

function formatCreatedAt(value: string) {
  const date = new Date(value);
  return [submissionDateFormat.format(date), submissionTimeFormat.format(date)];
}

function formatSelectedReasons(reasons: SelectedContractEndReason[]) {
  return reasons.map((reason) => reason.label).join("、");
}

async function fetchSubmissions(formId: string, signal: AbortSignal) {
  const collected: SubmissionRow[] = [];
  for (let start = 0; ; start += SUBMISSION_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("contract_end_submissions")
      .select("id,rider_name,satisfaction,selected_reasons,details,created_at")
      .eq("form_id", formId)
      .order("created_at", { ascending: false })
      .range(start, start + SUBMISSION_PAGE_SIZE - 1)
      .abortSignal(signal);
    signal.throwIfAborted();
    if (error) throw error;
    const page = (data as SubmissionRow[] | null) ?? [];
    collected.push(...page);
    if (page.length < SUBMISSION_PAGE_SIZE) return collected;
  }
}

export default function ContractEndAdminPage() {
  const [forms, setForms] = useState<ContractEndFormRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [reasonDraft, setReasonDraft] = useState<ContractEndReasonOption[]>(DEFAULT_CONTRACT_END_REASONS.map((item) => ({ ...item })));
  const [editingForm, setEditingForm] = useState<ContractEndFormRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [savingReasons, setSavingReasons] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ContractEndFormRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [submissionsError, setSubmissionsError] = useState("");
  const [exportTarget, setExportTarget] = useState<ContractEndFormRow | null>(null);
  const [exportRows, setExportRows] = useState<SubmissionRow[] | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const exportDialogRef = useRef<HTMLDialogElement>(null);
  const exportRequest = useRef<AbortController | null>(null);
  const resultsRequest = useRef<AbortController | null>(null);
  const selectedForm = forms.find((form) => form.id === selectedFormId);
  const submissionsReady = !submissionsLoading && !submissionsError;
  const reasonLabels = useMemo(() => {
    const labels = new Set(selectedForm?.reasons.map((item) => item.label) ?? []);
    for (const submission of submissions) {
      for (const reason of submission.selected_reasons) labels.add(reason.label);
    }
    return [...labels];
  }, [selectedForm, submissions]);
  const reasonCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const submission of submissions) {
      for (const reason of submission.selected_reasons) {
        counts[reason.label] = (counts[reason.label] ?? 0) + 1;
      }
    }
    return counts;
  }, [submissions]);
  const averageSatisfaction = submissions.length
    ? (submissions.reduce((sum, item) => sum + item.satisfaction, 0) / submissions.length).toFixed(1)
    : "—";

  useEffect(() => {
    let active = true;
    async function loadForms() {
      const { data, error } = await supabase
        .from("contract_end_forms")
        .select("id,title,description,reasons,is_open,created_at")
        .order("created_at", { ascending: false });
      if (!active) return;
      setForms((data as ContractEndFormRow[] | null) ?? []);
      setErrorMessage(error ? "表单列表加载失败，请确认数据库迁移已执行后刷新页面" : "");
      setLoading(false);
    }
    void loadForms();
    return () => { active = false; };
  }, []);

  useEffect(() => () => {
    resultsRequest.current?.abort();
    exportRequest.current?.abort();
  }, []);

  async function createForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newTitle.trim();
    const reasons = reasonDraft.map((item) => ({ ...item, label: item.label.trim(), requiresDetails: item.label.trim() === "其他原因" }));
    if (!title || title.length > 80 || !validContractEndReasons(reasons)) {
      setErrorMessage("请填写表单名称，并检查原因是否为空或重复");
      return;
    }
    setCreating(true);
    setErrorMessage("");
    const { data, error } = await supabase
      .from("contract_end_forms")
      .insert({ title, reasons })
      .select("id,title,description,reasons,is_open,created_at")
      .single();
    setCreating(false);
    if (error || !data) {
      setErrorMessage("新建表单失败，请稍后重试");
      return;
    }
    setForms((current) => [data as ContractEndFormRow, ...current]);
    setCreateOpen(false);
    setNewTitle("");
    setReasonDraft(DEFAULT_CONTRACT_END_REASONS.map((item) => ({ ...item })));
  }

  async function saveReasons(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingForm) return;
    const reasons = reasonDraft.map((item) => ({ ...item, label: item.label.trim(), requiresDetails: item.label.trim() === "其他原因" }));
    if (!validContractEndReasons(reasons)) {
      setErrorMessage("请检查原因是否为空或重复");
      return;
    }
    setSavingReasons(true);
    setErrorMessage("");
    const { data, error } = await supabase
      .from("contract_end_forms")
      .update({ reasons })
      .eq("id", editingForm.id)
      .select("id,reasons")
      .single();
    setSavingReasons(false);
    if (error || !data) {
      setErrorMessage("原因保存失败，请稍后重试");
      return;
    }
    setForms((current) => current.map((item) => item.id === data.id ? { ...item, reasons: data.reasons as ContractEndReasonOption[] } : item));
    setEditingForm(null);
  }

  async function deleteForm() {
    if (!deleteTarget) return;
    setDeleting(true);
    setErrorMessage("");
    const { data, error } = await supabase
      .from("contract_end_forms")
      .delete()
      .eq("id", deleteTarget.id)
      .select("id")
      .single();
    setDeleting(false);
    if (error || !data) {
      setErrorMessage("删除失败，请确认表单已关闭后重试");
      return;
    }
    setForms((current) => current.filter((item) => item.id !== deleteTarget.id));
    if (selectedFormId === deleteTarget.id) {
      resultsRequest.current?.abort();
      setSelectedFormId(null);
      setSubmissions([]);
      setSubmissionsLoading(false);
    }
    setDeleteTarget(null);
  }

  async function toggleCollection(form: ContractEndFormRow) {
    setPendingId(form.id);
    setErrorMessage("");
    const { data, error } = await supabase
      .from("contract_end_forms")
      .update({ is_open: !form.is_open })
      .eq("id", form.id)
      .select("id,is_open")
      .single();
    setPendingId(null);
    if (error || !data) {
      setErrorMessage("收集状态更新失败，请稍后重试");
      return;
    }
    setForms((current) => current.map((item) => item.id === data.id ? { ...item, is_open: data.is_open } : item));
  }

  async function copyLink(form: ContractEndFormRow) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/contract-end/${form.id}`);
    } catch {
      setErrorMessage("复制失败，请手动打开表单后复制地址");
    }
  }

  async function loadSubmissions(formId: string) {
    resultsRequest.current?.abort();
    const request = new AbortController();
    resultsRequest.current = request;
    setSelectedFormId(formId);
    setSubmissions([]);
    setSubmissionsError("");
    setSubmissionsLoading(true);

    try {
      const rows = await fetchSubmissions(formId, request.signal);
      if (!request.signal.aborted) setSubmissions(rows);
    } catch {
      if (!request.signal.aborted) {
        setSubmissionsError("收集结果加载失败，请确认结果查看迁移已执行后重试");
      }
    } finally {
      if (!request.signal.aborted) setSubmissionsLoading(false);
    }
  }

  function selectForm(formId: string) {
    void loadSubmissions(formId);
  }

  async function openExportDialog(form: ContractEndFormRow) {
    const cachedRows = form.id === selectedFormId && submissionsReady ? submissions : null;
    setExportTarget(form);
    setExportRows(cachedRows);
    setExportError("");
    exportDialogRef.current?.showModal();
    if (cachedRows) return;

    const request = new AbortController();
    exportRequest.current = request;
    try {
      const rows = await fetchSubmissions(form.id, request.signal);
      if (!request.signal.aborted) setExportRows(rows);
    } catch {
      if (!request.signal.aborted) setExportError("提交记录加载失败，请重新打开导出重试。");
    }
  }

  function closeExportDialog() {
    exportRequest.current?.abort();
    exportDialogRef.current?.close();
    setExportTarget(null);
    setExportRows(null);
  }

  async function exportSubmissions() {
    if (!exportTarget || !exportRows?.length || exporting) return;
    setExporting(true);
    setExportError("");
    try {
      const { utils, writeFileXLSX } = await import("xlsx");
      const rows = exportRows.map((item) => [
        ...formatCreatedAt(item.created_at),
        item.rider_name,
        item.satisfaction,
        formatSelectedReasons(item.selected_reasons),
        item.details ?? "",
      ]);
      const sheet = utils.aoa_to_sheet([SUBMISSION_HEADERS, ...rows]);
      sheet["!cols"] = [{ wch: 19 }, { wch: 12 }, { wch: 18 }, { wch: 10 }, { wch: 38 }, { wch: 46 }];
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, sheet, "提交记录");
      const fileTitle = exportTarget.title.replace(/[<>:"/\\|?*\p{Cc}]/gu, "_");
      writeFileXLSX(workbook, `${fileTitle}-提交记录.xlsx`, { compression: true });
      closeExportDialog();
    } catch {
      setExportError("导出失败，请重试。");
    } finally {
      setExporting(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.backLink} href="/admin">← 返回后台管理</Link>
        <div className={styles.headerRow}>
          <div>
            <h1>断签统计</h1>
          </div>
          <div className={styles.headerActions}>
            <button className={styles.primaryButton} type="button" onClick={() => { setErrorMessage(""); setReasonDraft(DEFAULT_CONTRACT_END_REASONS.map((item) => ({ ...item }))); setCreateOpen(true); }}>+ 新建表单</button>
          </div>
        </div>
      </header>

      {errorMessage ? <div className={styles.error} role="alert">{errorMessage}</div> : null}

      <section className={styles.listSection}>
        <div className={styles.sectionHeading}><h2>表单</h2><span>{forms.length}</span></div>
        {loading ? <div className={styles.empty}>加载中…</div> : null}
        {!loading && forms.length === 0 && !errorMessage ? <div className={styles.empty}>还没有表单。点击“新建表单”开始收集。</div> : null}
        <div className={styles.grid}>
          {forms.map((form) => (
            <article className={`${styles.formCard} ${selectedFormId === form.id ? styles.selectedCard : ""}`} key={form.id}>
              <div className={styles.cardHeader}>
                <button className={styles.cardSelect} type="button" aria-pressed={selectedFormId === form.id} aria-controls={selectedFormId === form.id ? "contract-end-results" : undefined} onClick={() => selectForm(form.id)}>
                  <span className={form.is_open ? styles.openBadge : styles.closedBadge}>{form.is_open ? "收集中" : "已关闭"}</span>
                  <span className={styles.cardTitle}>{form.title}</span>
                </button>
                <button className={styles.deleteButton} type="button" onClick={() => { setErrorMessage(""); setDeleteTarget(form); }}>删除</button>
              </div>
              <div className={styles.cardActions}>
                <button className={styles.secondaryButton} type="button" onClick={() => { setErrorMessage(""); setReasonDraft(form.reasons.map((item) => ({ ...item }))); setEditingForm(form); }}>编辑原因</button>
                <button className={styles.secondaryButton} type="button" onClick={() => void copyLink(form)}>复制链接</button>
                <button className={form.is_open ? styles.closeButton : styles.primaryButton} type="button" disabled={pendingId === form.id} onClick={() => void toggleCollection(form)}>
                  {pendingId === form.id ? "处理中…" : form.is_open ? "关闭收集" : "开启收集"}
                </button>
                <button className={styles.secondaryButton} type="button" onClick={() => void openExportDialog(form)}>导出</button>
              </div>
            </article>
          ))}
        </div>
        {selectedForm ? (
          <section className={styles.resultsSection} id="contract-end-results" aria-live="polite">
            <div className={styles.resultsHeading}>
              <div>
                <h2>{selectedForm.title}</h2>
              </div>
            </div>
            {submissionsLoading ? <div className={styles.empty}>正在加载收集结果…</div> : null}
            {submissionsError ? <div className={styles.error} role="alert">{submissionsError}</div> : null}
            {submissionsReady ? (
              <>
                <div className={styles.summaryGrid}>
                  <div className={styles.summaryItem}><span>提交数量</span><strong>{submissions.length}</strong></div>
                  <div className={styles.summaryItem}><span>平均满意度</span><strong>{averageSatisfaction}{submissions.length ? " / 5" : ""}</strong></div>
                </div>
                <div className={styles.reasonSummary}>
                  <h3>断签原因分布</h3>
                  {reasonLabels.map((label) => {
                    const count = reasonCounts[label] ?? 0;
                    return (
                      <div className={styles.reasonRow} key={label}>
                        <span>{label}</span>
                        <div className={styles.reasonTrack}><span style={{ width: `${submissions.length ? count / submissions.length * 100 : 0}%` }} /></div>
                        <strong>{count}</strong>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}
            <div className={styles.recordsHeading}>
              <h3>提交记录</h3>
            </div>
            {submissionsReady ? (
              submissions.length === 0 ? <div className={styles.empty}>这个表单还没有收到提交。</div> : (
                <div className={styles.tableWrap}>
                  <table className={styles.recordsTable}>
                    <thead><tr>{SUBMISSION_HEADERS.map((header) => <th key={header}>{header}</th>)}</tr></thead>
                    <tbody>
                      {submissions.map((item) => {
                        const [submissionDate, submissionTime] = formatCreatedAt(item.created_at);
                        return (
                          <tr key={item.id}>
                            <td>{submissionDate}</td>
                            <td>{submissionTime}</td>
                            <td>{item.rider_name}</td>
                            <td>{item.satisfaction} / 5</td>
                            <td>{formatSelectedReasons(item.selected_reasons)}</td>
                            <td>{item.details || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            ) : null}
          </section>
        ) : null}
      </section>

      <dialog
        ref={exportDialogRef}
        className={`${styles.dialog} ${styles.exportDialog}`}
        aria-labelledby="export-contract-end-title"
        aria-describedby="export-contract-end-description"
        onCancel={(event) => {
          event.preventDefault();
          if (!exporting) closeExportDialog();
        }}
      >
        <h2 id="export-contract-end-title">导出提交记录？</h2>
        <div id="export-contract-end-description" aria-live="polite">
          {exportRows && exportRows.length > 0 ? <p>确定导出「{exportTarget?.title}」的 {exportRows.length} 条提交记录吗？</p> : null}
          {exportRows?.length === 0 ? <p>「{exportTarget?.title}」还没有收到提交。</p> : null}
          {!exportRows && !exportError ? <p>正在加载「{exportTarget?.title}」的提交记录…</p> : null}
        </div>
        {exportError ? <div className={styles.error} role="alert">{exportError}</div> : null}
        <div className={styles.dialogActions}>
          <button className={styles.secondaryButton} type="button" disabled={exporting} onClick={closeExportDialog}>取消</button>
          <button className={styles.primaryButton} type="button" disabled={!exportRows?.length || exporting} onClick={() => void exportSubmissions()}>{exporting ? "导出中…" : "确认导出"}</button>
        </div>
      </dialog>

      {createOpen ? (
        <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="new-contract-end-title">
          <form className={styles.dialog} onSubmit={createForm}>
            <h2 id="new-contract-end-title">新建断签统计表单</h2>
            <label>
              <span>表单名称</span>
              <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} maxLength={80} placeholder="例如：11 月断签统计" autoFocus />
            </label>
            <ReasonEditor reasons={reasonDraft} onChange={setReasonDraft} />
            {errorMessage ? <div className={styles.error} role="alert">{errorMessage}</div> : null}
            <div className={styles.dialogActions}>
              <button className={styles.secondaryButton} type="button" disabled={creating} onClick={() => setCreateOpen(false)}>取消</button>
              <button className={styles.primaryButton} type="submit" disabled={creating}>{creating ? "创建中…" : "创建表单"}</button>
            </div>
          </form>
        </div>
      ) : null}

      {editingForm ? (
        <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="edit-contract-end-title">
          <form className={styles.dialog} onSubmit={saveReasons}>
            <h2 id="edit-contract-end-title">编辑断签原因</h2>
            <ReasonEditor reasons={reasonDraft} onChange={setReasonDraft} />
            {errorMessage ? <div className={styles.error} role="alert">{errorMessage}</div> : null}
            <div className={styles.dialogActions}>
              <button className={styles.secondaryButton} type="button" disabled={savingReasons} onClick={() => setEditingForm(null)}>取消</button>
              <button className={styles.primaryButton} type="submit" disabled={savingReasons}>{savingReasons ? "保存中…" : "保存原因"}</button>
            </div>
          </form>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="delete-contract-end-title">
          <div className={styles.dialog}>
            <h2 id="delete-contract-end-title">删除表单？</h2>
            <p>“{deleteTarget.title}”及其全部提交记录将一并删除。</p>
            {errorMessage ? <div className={styles.error} role="alert">{errorMessage}</div> : null}
            <div className={styles.dialogActions}>
              <button className={styles.secondaryButton} type="button" disabled={deleting} onClick={() => setDeleteTarget(null)}>取消</button>
              <button className={styles.deleteButton} type="button" disabled={deleting} onClick={() => void deleteForm()}>{deleting ? "删除中…" : "确认删除"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
