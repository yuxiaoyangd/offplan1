import { createClient } from "@supabase/supabase-js";

type ApplicationRequest = {
  companySize?: unknown;
  contactName?: unknown;
  contactMethod?: unknown;
  contactValue?: unknown;
};

function errorResponse(message: string, status: number) {
  return Response.json({ message }, { status });
}

export async function POST(request: Request) {
  let body: ApplicationRequest;
  try {
    body = await request.json() as ApplicationRequest;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid request");
  } catch {
    return errorResponse("提交内容无效", 400);
  }

  const companySize = body.companySize;
  const contactName = typeof body.contactName === "string" ? body.contactName.trim() : "";
  const contactMethod = body.contactMethod;
  const contactValue = typeof body.contactValue === "string" ? body.contactValue.trim() : "";

  if (typeof companySize !== "number" || !Number.isSafeInteger(companySize) || companySize < 1 || companySize > 1_000_000) {
    return errorResponse("请填写有效的公司人数", 400);
  }
  if (contactName.length < 1 || contactName.length > 40) {
    return errorResponse("请填写 1 至 40 字的称呼", 400);
  }
  if (contactMethod !== "email" && contactMethod !== "phone") {
    return errorResponse("请选择邮箱或电话作为联系方式", 400);
  }
  if (contactMethod === "email" && (contactValue.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactValue))) {
    return errorResponse("请填写有效的联系邮箱", 400);
  }
  const phoneDigits = contactValue.replace(/\D/g, "");
  if (contactMethod === "phone" && (contactValue.length > 30 || !/^\+?[\d() -]+$/.test(contactValue) || phoneDigits.length < 7 || phoneDigits.length > 15)) {
    return errorResponse("请填写有效的联系电话", 400);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return errorResponse("申请服务暂不可用", 503);
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await supabase.from("system_applications").insert({
      company_size: companySize,
      contact_name: contactName,
      contact_email: contactMethod === "email" ? contactValue : null,
      contact_phone: contactMethod === "phone" ? contactValue : null,
    });
    if (error) return errorResponse("申请保存失败，请稍后重试", 500);
    return Response.json({ success: true }, { status: 201 });
  } catch {
    return errorResponse("申请提交失败，请稍后重试", 500);
  }
}
