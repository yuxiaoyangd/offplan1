"use client";

import { useMemo, useState } from "react";
import { parseRiderTeamFile, parseXlsFile, validateRiderTeamFile } from "@/lib/xls";
import { supabase } from "@/lib/supabase";
import type {
  RiderTeamFileData,
  RiderTeamValidation,
  ScheduleWeekRow,
  XlsData,
} from "@/lib/types";

type ParsedFile<T> = {
  fileName: string;
  file: File;
  data: T;
};

const XLS_TEMPLATE_BUCKET = "xls-templates";

function getExcelContentType(fileName: string): string {
  return fileName.toLowerCase().endsWith(".xlsx")
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : "application/vnd.ms-excel";
}

function createOriginalFilePath(weekId: string, fileName: string): string {
  const extension = fileName.toLowerCase().endsWith(".xlsx") ? "xlsx" : "xls";
  const uniqueId = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${weekId}/${uniqueId}.${extension}`;
}

type ImportWeekDialogProps = {
  week: ScheduleWeekRow;
  onClose: () => void;
  onImported: (message: string) => void;
};

function ValidationDetails({ validation }: { validation: RiderTeamValidation }) {
  const errors = [
    validation.missingInTeam.length > 0
      ? `小队文档缺少 ${validation.missingInTeam.length} 名骑手：${validation.missingInTeam.slice(0, 5).map((rider) => rider.riderName).join("、")}`
      : null,
    validation.extraInTeam.length > 0
      ? `小队文档多出 ${validation.extraInTeam.length} 名骑手：${validation.extraInTeam.slice(0, 5).map((rider) => rider.riderName).join("、")}`
      : null,
    validation.nameMismatches.length > 0
      ? `有 ${validation.nameMismatches.length} 名骑手姓名不一致`
      : null,
    validation.duplicateRiderIds.length > 0
      ? `有 ${validation.duplicateRiderIds.length} 个重复骑手ID`
      : null,
    validation.conflictingRiderIds.length > 0
      ? `有 ${validation.conflictingRiderIds.length} 名骑手对应多个小队或姓名`
      : null,
    validation.conflictingGroups.length > 0
      ? `有 ${validation.conflictingGroups.length} 个分组ID对应多个名称`
      : null,
  ].filter(Boolean);

  return (
    <div className={validation.valid ? "import-validation validation-ok" : "import-validation validation-error"}>
      <strong>{validation.valid ? "名单校验通过" : "名单不一致，请检查是否上传了错误文件"}</strong>
      <span>
        意愿文档 {validation.preferenceRiderCount} 人 · 小队文档 {validation.teamRiderCount} 人 · 匹配 {validation.matchedCount} 人
      </span>
      {errors.length > 0 ? (
        <ul>
          {errors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

export default function ImportWeekDialog({ week, onClose, onImported }: ImportWeekDialogProps) {
  const [preferenceFile, setPreferenceFile] = useState<ParsedFile<XlsData> | null>(null);
  const [teamFile, setTeamFile] = useState<ParsedFile<RiderTeamFileData> | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const validation = useMemo(
    () => preferenceFile && teamFile
      ? validateRiderTeamFile(preferenceFile.data.riders, teamFile.data)
      : null,
    [preferenceFile, teamFile],
  );

  const dateRangeMatches = Boolean(
    preferenceFile
    && preferenceFile.data.weekStart === week.start_date
    && preferenceFile.data.weekEnd === week.end_date,
  );
  const canImport = Boolean(
    preferenceFile
    && dateRangeMatches
    && (!teamFile || validation?.valid)
    && !importing,
  );

  async function readPreferenceFile(file: File | undefined) {
    if (!file) return;
    setParseError(null);
    try {
      const data = parseXlsFile(await file.arrayBuffer());
      setPreferenceFile({ fileName: file.name, file, data });
    } catch (error) {
      setPreferenceFile(null);
      setParseError(error instanceof Error ? error.message : "无法解析时段意愿文档");
    }
  }

  async function readTeamFile(file: File | undefined) {
    if (!file) return;
    setParseError(null);
    try {
      const data = parseRiderTeamFile(await file.arrayBuffer());
      setTeamFile({ fileName: file.name, file, data });
    } catch (error) {
      setTeamFile(null);
      setParseError(error instanceof Error ? error.message : "无法解析骑手小队数据");
    }
  }

  async function submitImport() {
    if (!preferenceFile || !canImport) return;
    setImporting(true);
    setParseError(null);

    const originalFilePath = createOriginalFilePath(week.id, preferenceFile.fileName);
    let uploadedFilePath: string | null = null;
    let dataImported = false;

    try {
      const { data: previousSnapshot, error: previousSnapshotError } = await supabase
        .from("week_import_snapshots")
        .select("original_file_path")
        .eq("week_id", week.id)
        .maybeSingle();

      if (previousSnapshotError) throw previousSnapshotError;

      const { error: uploadError } = await supabase.storage
        .from(XLS_TEMPLATE_BUCKET)
        .upload(originalFilePath, preferenceFile.file, {
          contentType: getExcelContentType(preferenceFile.fileName),
          upsert: false,
        });

      if (uploadError) {
        throw new Error(`原始文件保存失败：${uploadError.message}`);
      }
      uploadedFilePath = originalFilePath;

      const payload = {
        ...preferenceFile.data,
        teams: teamFile?.data.teams ?? [],
        riderTeams: teamFile?.data.assignments ?? [],
      };
      const { data, error } = await supabase.rpc("import_xls_week", {
        p_week_id: week.id,
        p_data: payload,
      });

      if (error) throw error;
      dataImported = true;

      const { error: snapshotUpdateError } = await supabase
        .from("week_import_snapshots")
        .update({
          original_file_path: originalFilePath,
          original_file_name: preferenceFile.fileName,
        })
        .eq("week_id", week.id);

      if (snapshotUpdateError) throw snapshotUpdateError;

      const previousFilePath = typeof previousSnapshot?.original_file_path === "string"
        ? previousSnapshot.original_file_path
        : null;
      if (previousFilePath && previousFilePath !== originalFilePath) {
        await supabase.storage.from(XLS_TEMPLATE_BUCKET).remove([previousFilePath]);
      }

      uploadedFilePath = null;
      const teamCount = Number(data?.teamCount ?? (teamFile?.data.teams.length || 1));
      const riderCount = Number(data?.riderCount ?? preferenceFile.data.riders.length);
      onImported(`导入成功：${riderCount} 名骑手，${teamCount} 个小队`);
    } catch (error) {
      console.error("Importing schedule workbook failed", error);
      if (uploadedFilePath) {
        await supabase.storage.from(XLS_TEMPLATE_BUCKET).remove([uploadedFilePath]);
      }
      if (dataImported) {
        setParseError("排班数据已导入，但原始文件保存失败，请重新导入一次。");
      } else {
        setParseError(error instanceof Error ? error.message : "导入失败，请稍后重试");
      }
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="confirm-overlay import-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !importing) onClose();
    }}>
      <section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <header className="import-dialog-header">
          <div>
            <h2 id="import-title">导入排班数据</h2>
            <p>{week.name || `${week.start_date} ~ ${week.end_date}`}</p>
          </div>
          <button className="icon-button" type="button" title="关闭" aria-label="关闭" onClick={onClose} disabled={importing}>×</button>
        </header>

        <div className="import-file-list">
          <label className={preferenceFile ? "import-file-row file-ready" : "import-file-row"}>
            <span className="file-step">1</span>
            <span className="file-copy">
              <strong>骑手时段意愿文档 <em>必选</em></strong>
              <small>{preferenceFile ? preferenceFile.fileName : "支持 .xls 或 .xlsx"}</small>
              {preferenceFile ? (
                <span>{preferenceFile.data.riders.length} 名骑手 · {preferenceFile.data.weekStart} ~ {preferenceFile.data.weekEnd}</span>
              ) : null}
            </span>
            <span className="file-command">{preferenceFile ? "重新选择" : "选择文件"}</span>
            <input type="file" accept=".xls,.xlsx" onChange={(event) => void readPreferenceFile(event.target.files?.[0])} />
          </label>

          <label className={teamFile ? "import-file-row file-ready" : "import-file-row"}>
            <span className="file-step">2</span>
            <span className="file-copy">
              <strong>骑手小队数据 <em className="optional-label">可选</em></strong>
              <small>{teamFile ? teamFile.fileName : "不上传时，所有骑手进入默认小队"}</small>
              {teamFile ? (
                <span>{teamFile.data.assignments.length} 名骑手 · 识别到 {teamFile.data.teams.length} 个小队</span>
              ) : null}
            </span>
            <span className="file-command">{teamFile ? "重新选择" : "选择文件"}</span>
            <input type="file" accept=".xls,.xlsx" onChange={(event) => void readTeamFile(event.target.files?.[0])} />
          </label>
        </div>

        {teamFile ? (
          <button className="btn-ghost btn-sm remove-team-file" type="button" onClick={() => setTeamFile(null)} disabled={importing}>
            移除小队文件，使用默认小队
          </button>
        ) : null}

        {validation ? <ValidationDetails validation={validation} /> : null}
        {preferenceFile && !dateRangeMatches ? (
          <div className="import-validation validation-error">
            <strong>文件日期与当前排班周不一致</strong>
            <span>
              文件为 {preferenceFile.data.weekStart} ~ {preferenceFile.data.weekEnd}，当前排班周为 {week.start_date} ~ {week.end_date}
            </span>
          </div>
        ) : null}
        {parseError ? <div className="import-validation validation-error">{parseError}</div> : null}

        <footer className="import-dialog-actions">
          <span>{teamFile ? "两份名单必须完全一致" : "将按单小队模式导入"}</span>
          <button className="btn-secondary" type="button" onClick={onClose} disabled={importing}>取消</button>
          <button className="btn-primary" type="button" onClick={() => void submitImport()} disabled={!canImport}>
            {importing ? "正在导入..." : "确认导入"}
          </button>
        </footer>
      </section>
    </div>
  );
}
