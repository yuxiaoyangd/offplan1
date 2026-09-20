import { createClient } from "@supabase/supabase-js";

function getClientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "";
}

function isLocalIp(ip: string) {
  return !ip || ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.168.") || ip.startsWith("10.");
}

async function getPublicIp() {
  try {
    const response = await fetch("https://api64.ipify.org?format=json", {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return "";
    const result = (await response.json()) as { ip?: string };
    return result.ip || "";
  } catch {
    return "";
  }
}

async function resolveCity(ip: string) {
  const lookupIp = isLocalIp(ip) ? await getPublicIp() : ip;
  if (!lookupIp) return "未知城市";

  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(lookupIp)}?fields=success,city`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return "未知城市";
    const result = (await response.json()) as { success?: boolean; city?: string };
    return result.success && result.city ? result.city.slice(0, 40) : "未知城市";
  } catch {
    return "未知城市";
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const incomeSatisfaction = Number(body.incomeSatisfaction);
    const managementSatisfaction = Number(body.managementSatisfaction);
    const otherFeedback = typeof body.otherFeedback === "string" ? body.otherFeedback.trim() : "";
    const riderName = typeof body.riderName === "string" ? body.riderName.trim() : "";

    if (![incomeSatisfaction, managementSatisfaction].every((value) => Number.isInteger(value) && value >= 1 && value <= 5)) {
      return Response.json({ message: "请选择有效的满意度评分" }, { status: 400 });
    }
    if (otherFeedback.length > 2000 || riderName.length > 40) {
      return Response.json({ message: "填写内容过长" }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return Response.json({ message: "反馈服务暂不可用" }, { status: 500 });
    }

    const city = await resolveCity(getClientIp(request));
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { error } = await supabase.from("rider_feedback").insert({
      city,
      income_satisfaction: incomeSatisfaction,
      management_satisfaction: managementSatisfaction,
      other_feedback: otherFeedback || null,
      rider_name: riderName || null,
    });

    if (error) {
      return Response.json({ message: "反馈保存失败，请稍后重试" }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch {
    return Response.json({ message: "提交失败，请稍后重试" }, { status: 400 });
  }
}
