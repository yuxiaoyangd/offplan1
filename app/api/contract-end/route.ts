import { createClient } from "@supabase/supabase-js";
import { validContractEndReasons, type ContractEndReasonOption } from "@/lib/contract-end";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const formId = typeof body.formId === "string" ? body.formId : "";
    const riderName = typeof body.riderName === "string" ? body.riderName.trim() : "";
    const satisfaction = Number(body.satisfaction);
    const rawReasonIds: unknown[] = Array.isArray(body.reasonIds) ? body.reasonIds : [];
    const details = typeof body.details === "string" ? body.details.trim() : "";

    if (!UUID_PATTERN.test(formId)) {
      return Response.json({ message: "表单链接无效" }, { status: 400 });
    }
    if (riderName.length < 1 || riderName.length > 40) {
      return Response.json({ message: "请填写 1 至 40 个字的姓名" }, { status: 400 });
    }
    if (!Number.isInteger(satisfaction) || satisfaction < 1 || satisfaction > 5) {
      return Response.json({ message: "请选择满意度评分" }, { status: 400 });
    }
    if (rawReasonIds.length < 1 || rawReasonIds.length > 20
      || !rawReasonIds.every((id) => typeof id === "string" && id.length <= 80)
      || new Set(rawReasonIds).size !== rawReasonIds.length) {
      return Response.json({ message: "请选择有效的断签原因" }, { status: 400 });
    }
    const reasonIds = rawReasonIds as string[];
    if (details.length > 1000) {
      return Response.json({ message: "其他原因说明不能超过 1000 字" }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return Response.json({ message: "表单服务暂不可用" }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: form, error: formError } = await supabase
      .from("contract_end_forms")
      .select("is_open,reasons")
      .eq("id", formId)
      .maybeSingle();

    if (formError || !form) {
      return Response.json({ message: "表单不存在或暂不可用" }, { status: 404 });
    }
    if (!form.is_open) {
      return Response.json({ message: "此表单已关闭收集" }, { status: 409 });
    }
    if (!validContractEndReasons(form.reasons)) {
      return Response.json({ message: "表单原因设置无效" }, { status: 500 });
    }
    const configuredReasons = form.reasons as ContractEndReasonOption[];
    const selectedReasons = reasonIds.map((id) => configuredReasons.find((item) => item.id === id));
    if (selectedReasons.some((item) => !item)) {
      return Response.json({ message: "断签原因已调整，请刷新页面后重试" }, { status: 409 });
    }
    if (selectedReasons.some((item) => item?.label === "其他原因") && !details) {
      return Response.json({ message: "请说明其他原因" }, { status: 400 });
    }

    const selected = selectedReasons.map((item) => ({ id: item!.id, label: item!.label }));

    const { error } = await supabase.from("contract_end_submissions").insert({
      form_id: formId,
      rider_name: riderName,
      satisfaction,
      reason: selected[0].id,
      reason_label: selected[0].label,
      selected_reasons: selected,
      details: selected.some((item) => item.label === "其他原因") ? details : null,
    });
    if (error) {
      return Response.json({ message: "提交失败，表单可能已关闭，请稍后重试" }, { status: 409 });
    }

    return Response.json({ success: true });
  } catch {
    return Response.json({ message: "提交失败，请稍后重试" }, { status: 400 });
  }
}
