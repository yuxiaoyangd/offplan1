import * as XLSX from "xlsx";
import type {
  RiderTeamFileData,
  RiderTeamValidation,
  XlsData,
  XlsEntry,
  XlsRider,
  XlsSlotDef,
} from "@/lib/types";

function parseTimeRange(label: string): { startTime: string; endTime: string } {
  const parts = label.split("|");
  const range = parts[1] ?? "";
  const times = range.split("-");
  return {
    startTime: (times[0] ?? "").trim(),
    endTime: (times[1] ?? "").replace(/\|.*$/, "").trim(),
  };
}

function extractSlotName(label: string): string {
  const idx = label.indexOf("|");
  if (idx === -1) return label.trim();
  return label.slice(0, idx).trim();
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function normalizeDateDigits(value: string): string {
  if (!/^\d{8}$/.test(value)) return "";
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return "";
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() + 1 !== month
    || date.getUTCDate() !== day
  ) {
    return "";
  }
  return value;
}

/** 将 XLS 日期单元格统一为 YYYYMMDD，避免导出时与数据库日期键不匹配 */
export function normalizeXlsDate(value: unknown): string {
  if (value == null || value === "") return "";

  if (typeof value === "number" && Number.isFinite(value)) {
    const compactDate = normalizeDateDigits(String(Math.trunc(value)));
    if (compactDate) return compactDate;

    const parsed = XLSX.SSF?.parse_date_code?.(value);
    if (parsed && parsed.y >= 2000 && parsed.y <= 2100) {
      return `${parsed.y}${pad2(parsed.m)}${pad2(parsed.d)}`;
    }
    return "";
  }

  const str = String(value).trim();
  const compactDate = normalizeDateDigits(str);
  if (compactDate) return compactDate;

  const iso = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) {
    return normalizeDateDigits(`${iso[1]}${pad2(Number(iso[2]))}${pad2(Number(iso[3]))}`);
  }

  const digits = str.replace(/\D/g, "");
  if (digits.length === 8) return normalizeDateDigits(digits);

  return "";
}

export function parseXlsFile(buffer: ArrayBuffer): XlsData {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][];

  if (rows.length < 2) throw new Error("文件内容为空");

  const header = rows[0];
  // Header format: 管理组ID | 管理组名称 | 骑手ID | 骑手姓名 | 日期 | 骑手类型 | slot1 | slot2 | ...
  const requiredHeaders = ["管理组ID", "管理组名称", "骑手ID", "骑手姓名", "日期", "骑手类型"];
  if (requiredHeaders.some((label, index) => String(header[index] ?? "").trim() !== label)) {
    throw new Error("时段意愿文档格式不正确，请确认前六列未被修改");
  }

  let actualSlotStart = -1;
  for (let i = 0; i < header.length; i++) {
    const h = header[i]?.trim();
    if (h && h !== "管理组ID" && h !== "管理组名称" && h !== "骑手ID" && h !== "骑手姓名" && h !== "日期" && h !== "骑手类型") {
      actualSlotStart = i;
      break;
    }
  }
  if (actualSlotStart < requiredHeaders.length) {
    throw new Error("时段意愿文档中没有可识别的时段列");
  }

  const slots: XlsSlotDef[] = [];
  const slotLabels: string[] = [];
  const slotColumnIndexes: number[] = [];
  let slotOrder = 1;
  for (let i = actualSlotStart; i < header.length; i++) {
    const h = header[i];
    if (!h?.trim()) continue;
    slots.push({
      name: extractSlotName(h),
      startTime: parseTimeRange(h).startTime,
      endTime: parseTimeRange(h).endTime,
      sortOrder: slotOrder,
    });
    slotLabels.push(h);
    slotColumnIndexes.push(i);
    slotOrder += 1;
  }

  const groupId = String(rows[1]?.[0] ?? "").trim();
  const groupName = String(rows[1]?.[1] ?? "").trim();

  let minDate: string | null = null;
  let maxDate: string | null = null;
  for (let r = 1; r < rows.length; r++) {
    const dateStr = normalizeXlsDate(rows[r]?.[4]);
    if (dateStr) {
      if (!minDate || dateStr < minDate) minDate = dateStr;
      if (!maxDate || dateStr > maxDate) maxDate = dateStr;
    }
  }

  const weekStart = minDate
    ? `${minDate.slice(0, 4)}-${minDate.slice(4, 6)}-${minDate.slice(6, 8)}`
    : "";
  const weekEnd = maxDate
    ? `${maxDate.slice(0, 4)}-${maxDate.slice(4, 6)}-${maxDate.slice(6, 8)}`
    : "";
  if (!weekStart || !weekEnd) throw new Error("时段意愿文档中没有有效日期");

  const entries: XlsEntry[] = [];
  const riderNames = new Map<string, string>();
  const seen = new Set<string>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length < actualSlotStart + 1) continue;

    const riderId = String(row[2] ?? "").trim();
    const riderName = String(row[3] ?? "").trim();
    const dateStr = normalizeXlsDate(row[4]);
    if (!riderId || !riderName || !dateStr) continue;
    const existingName = riderNames.get(riderId);
    if (existingName && existingName !== riderName) {
      throw new Error(`骑手ID ${riderId} 对应了多个姓名`);
    }
    riderNames.set(riderId, riderName);

    const key = `${riderId}_${dateStr}`;
    if (seen.has(key)) {
      throw new Error(`骑手 ${riderName}（${riderId}）在 ${dateStr} 存在重复记录`);
    }
    seen.add(key);

    const selections: number[] = [];
    for (let i = actualSlotStart; i < Math.min(row.length, actualSlotStart + slots.length); i++) {
      const val = parseInt(String(row[i] ?? "0"), 10);
      selections.push(isNaN(val) ? 0 : val);
    }

    entries.push({ riderId, riderName, date: dateStr, selections });
  }
  if (entries.length === 0 || riderNames.size === 0) {
    throw new Error("时段意愿文档中没有有效骑手记录");
  }

  const columnCount = header.length;
  const snapshotRows = rows.slice(1).map((row) => {
    const arr: (string | number | null)[] = [];
    for (let i = 0; i < columnCount; i++) {
      const value = row?.[i];
      if (value === undefined) {
        arr.push("");
      } else if (i === 4) {
        arr.push(normalizeXlsDate(value));
      } else {
        arr.push(value as string | number | null);
      }
    }
    return arr;
  });

  return {
    weekStart,
    weekEnd,
    group: { id: groupId, name: groupName },
    slots,
    entries,
    riders: Array.from(riderNames, ([riderId, riderName]) => ({ riderId, riderName })),
    slotLabels,
    slotColumnIndexes,
    baseColumnCount: actualSlotStart,
    snapshot: {
      header: header.slice(0, columnCount),
      rows: snapshotRows,
    },
  };
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, "");
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, "");
}

function findRequiredColumn(header: unknown[], candidates: string[], label: string): number {
  const normalizedCandidates = new Set(candidates.map(normalizeHeader));
  const index = header.findIndex((cell) => normalizedCandidates.has(normalizeHeader(cell)));
  if (index < 0) throw new Error(`小队数据缺少“${label}”列`);
  return index;
}

export function parseRiderTeamFile(buffer: ArrayBuffer): RiderTeamFileData {
  const workbook = XLSX.read(buffer, { type: "array", raw: true });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(worksheet, {
    header: 1,
    raw: true,
    defval: "",
  }) as (string | number | null)[][];

  if (rows.length < 2) throw new Error("骑手小队数据内容为空");

  const header = rows[0] ?? [];
  const riderIdColumn = findRequiredColumn(header, ["骑手ID"], "骑手ID");
  const riderNameColumn = findRequiredColumn(header, ["骑手姓名", "姓名"], "骑手姓名");
  const groupIdColumn = findRequiredColumn(header, ["分组ID", "小队ID"], "分组ID");
  const groupNameColumn = findRequiredColumn(header, ["分组名称", "小队名称"], "分组名称");

  const assignments = [];
  const firstByRider = new Map<string, { riderName: string; externalGroupId: string; groupName: string }>();
  const groupNames = new Map<string, string>();
  const duplicateRiderIds = new Set<string>();
  const conflictingRiderIds = new Set<string>();
  const conflictingGroups = new Set<string>();

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const riderId = String(row[riderIdColumn] ?? "").trim();
    const riderName = String(row[riderNameColumn] ?? "").trim();
    const externalGroupId = String(row[groupIdColumn] ?? "").trim();
    const groupName = String(row[groupNameColumn] ?? "").trim();

    if (!riderId && !riderName && !externalGroupId && !groupName) continue;
    if (!riderId || !riderName || !externalGroupId || !groupName) {
      throw new Error(`小队数据第 ${rowIndex + 1} 行字段不完整`);
    }

    const existing = firstByRider.get(riderId);
    if (existing) {
      duplicateRiderIds.add(riderId);
      if (
        normalizeName(existing.riderName) !== normalizeName(riderName)
        || existing.externalGroupId !== externalGroupId
        || normalizeName(existing.groupName) !== normalizeName(groupName)
      ) {
        conflictingRiderIds.add(riderId);
      }
      continue;
    }

    const existingGroupName = groupNames.get(externalGroupId);
    if (existingGroupName && normalizeName(existingGroupName) !== normalizeName(groupName)) {
      conflictingGroups.add(externalGroupId);
    } else {
      groupNames.set(externalGroupId, groupName);
    }

    firstByRider.set(riderId, { riderName, externalGroupId, groupName });
    assignments.push({ riderId, riderName, externalGroupId, groupName });
  }

  if (assignments.length === 0) throw new Error("骑手小队数据中没有有效骑手");

  return {
    teams: Array.from(groupNames, ([externalGroupId, name]) => ({ externalGroupId, name })),
    assignments,
    duplicateRiderIds: Array.from(duplicateRiderIds),
    conflictingRiderIds: Array.from(conflictingRiderIds),
    conflictingGroups: Array.from(conflictingGroups),
  };
}

export function validateRiderTeamFile(
  preferenceRiders: XlsRider[],
  teamData: RiderTeamFileData,
): RiderTeamValidation {
  const preferenceMap = new Map(preferenceRiders.map((rider) => [rider.riderId, rider.riderName]));
  const teamMap = new Map(teamData.assignments.map((rider) => [rider.riderId, rider.riderName]));

  const missingInTeam = preferenceRiders.filter((rider) => !teamMap.has(rider.riderId));
  const extraInTeam = teamData.assignments
    .filter((rider) => !preferenceMap.has(rider.riderId))
    .map(({ riderId, riderName }) => ({ riderId, riderName }));
  const nameMismatches = teamData.assignments.flatMap((rider) => {
    const preferenceName = preferenceMap.get(rider.riderId);
    if (!preferenceName || normalizeName(preferenceName) === normalizeName(rider.riderName)) return [];
    return [{
      riderId: rider.riderId,
      preferenceName,
      teamName: rider.riderName,
    }];
  });
  const matchedCount = preferenceRiders.filter((rider) => teamMap.has(rider.riderId)).length;
  const valid = missingInTeam.length === 0
    && extraInTeam.length === 0
    && nameMismatches.length === 0
    && teamData.duplicateRiderIds.length === 0
    && teamData.conflictingRiderIds.length === 0
    && teamData.conflictingGroups.length === 0;

  return {
    valid,
    preferenceRiderCount: preferenceRiders.length,
    teamRiderCount: teamData.assignments.length,
    matchedCount,
    missingInTeam,
    extraInTeam,
    nameMismatches,
    duplicateRiderIds: teamData.duplicateRiderIds,
    conflictingRiderIds: teamData.conflictingRiderIds,
    conflictingGroups: teamData.conflictingGroups,
  };
}
