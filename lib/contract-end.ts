export type ContractEndReasonOption = {
  id: string;
  label: string;
  requiresDetails: boolean;
};

export type SelectedContractEndReason = Pick<ContractEndReasonOption, "id" | "label">;

export const DEFAULT_CONTRACT_END_REASONS: ContractEndReasonOption[] = [
  { id: "income", label: "收入或结算", requiresDetails: false },
  { id: "workload", label: "工作时间或强度", requiresDetails: false },
  { id: "management", label: "管理与沟通", requiresDetails: false },
  { id: "other_job", label: "转做其他工作", requiresDetails: false },
  { id: "personal", label: "个人或家庭原因", requiresDetails: false },
  { id: "other", label: "其他原因", requiresDetails: true },
];

export function validContractEndReasons(value: unknown): value is ContractEndReasonOption[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return false;
  const ids = new Set<string>();
  const labels = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") return false;
    const reason = item as Record<string, unknown>;
    if (typeof reason.id !== "string" || !/^[a-z0-9_-]{1,80}$/i.test(reason.id) || ids.has(reason.id)) return false;
    if (typeof reason.label !== "string" || !reason.label.trim() || reason.label.length > 80 || labels.has(reason.label.trim())) return false;
    if (typeof reason.requiresDetails !== "boolean") return false;
    ids.add(reason.id);
    labels.add(reason.label.trim());
  }
  return true;
}

export type ContractEndFormRow = {
  id: string;
  title: string;
  description: string | null;
  reasons: ContractEndReasonOption[];
  is_open: boolean;
  created_at: string;
};
