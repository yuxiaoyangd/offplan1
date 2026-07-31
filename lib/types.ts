export type ScheduleWeekRow = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  required_slots: number;
  default_slot_ids: string[] | null;
  created_at?: string;
  updated_at?: string;
};

export type TimeSlotRow = {
  id: string;
  week_id: string;
  name: string;
  start_time: string;
  end_time: string;
  sort_order: number;
  is_selectable: boolean;
  is_active: boolean;
};

export type ScheduleTeamRow = {
  id: string;
  week_id: string;
  external_group_id: string | null;
  name: string;
  is_default: boolean;
};

export type RiderRow = {
  rider_id: string;
  week_id: string;
  team_id: string;
  name: string;
  rider_type: string;
  is_active: boolean;
  rest_preference_mode: "random" | "specified" | null;
  preference_submitted_at: string | null;
};

export type RestDayLimitRow = {
  week_id: string;
  team_id: string;
  rest_date: string;
  max_slots: number;
};

export type RiderScheduleRow = {
  id: string;
  rider_id: string;
  week_id: string;
  work_date: string;
  slot_id: string | null;
  is_selected: boolean | null;
};

export type XlsSlotDef = {
  name: string;
  startTime: string;
  endTime: string;
  sortOrder: number;
};

export type XlsEntry = {
  riderId: string;
  riderName: string;
  date: string;
  selections: number[];
};

export type XlsRider = {
  riderId: string;
  riderName: string;
};

export type XlsSnapshot = {
  header: (string | number | null)[];
  rows: (string | number | null)[][];
};

export type XlsData = {
  weekStart: string;
  weekEnd: string;
  group: { id: string; name: string };
  slots: XlsSlotDef[];
  entries: XlsEntry[];
  riders: XlsRider[];
  slotLabels: string[];
  slotColumnIndexes: number[];
  baseColumnCount: number;
  snapshot: XlsSnapshot;
};

export type RiderTeamAssignment = {
  riderId: string;
  riderName: string;
  externalGroupId: string;
  groupName: string;
};

export type RiderTeamFileData = {
  teams: { externalGroupId: string; name: string }[];
  assignments: RiderTeamAssignment[];
  duplicateRiderIds: string[];
  conflictingRiderIds: string[];
  conflictingGroups: string[];
};

export type RiderTeamValidation = {
  valid: boolean;
  preferenceRiderCount: number;
  teamRiderCount: number;
  matchedCount: number;
  missingInTeam: XlsRider[];
  extraInTeam: XlsRider[];
  nameMismatches: {
    riderId: string;
    preferenceName: string;
    teamName: string;
  }[];
  duplicateRiderIds: string[];
  conflictingRiderIds: string[];
  conflictingGroups: string[];
};

export type ExportXlsData = {
  header: (string | number | null)[];
  rows: (string | number | null)[][];
  slotLabels: string[];
  slotColumnIndexes: number[];
  dateColumnIndex?: number;
  baseColumns: number;
  generated: boolean;
};
