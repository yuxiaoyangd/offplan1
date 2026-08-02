import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

const XLS_TEMPLATE_BUCKET = "xls-templates";
const XLS_MIME_TYPE = "application/vnd.ms-excel";
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const OLE_SIGNATURE = Buffer.from("d0cf11e0a1b11ae1", "hex");

type ExportRequest = {
  weekId?: unknown;
  fileName?: unknown;
  sourceBase64?: unknown;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isXlsFile(bytes: Buffer): boolean {
  return bytes.length >= OLE_SIGNATURE.length
    && bytes.subarray(0, OLE_SIGNATURE.length).equals(OLE_SIGNATURE);
}

function errorResponse(message: string, status: number) {
  return Response.json({ message }, { status });
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const cloudRunUrl = process.env.CLOUD_RUN_XLS_EXPORT_URL;

  if (!supabaseUrl || !supabaseKey || !cloudRunUrl) {
    return errorResponse("兼容导出服务尚未配置", 503);
  }

  let body: ExportRequest;
  try {
    body = await request.json() as ExportRequest;
  } catch {
    return errorResponse("请求内容无效", 400);
  }

  const weekId = typeof body.weekId === "string" ? body.weekId : "";
  const sourceBase64 = typeof body.sourceBase64 === "string" ? body.sourceBase64 : "";
  const requestedFileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
  const fileName = requestedFileName.toLowerCase().endsWith(".xls")
    ? requestedFileName
    : "排班.xls";

  if (!isUuid(weekId) || !sourceBase64) {
    return errorResponse("缺少有效的导出参数", 400);
  }

  if (sourceBase64.length > Math.ceil(MAX_FILE_BYTES * 4 / 3) + 8) {
    return errorResponse("导出文件过大", 413);
  }

  const sourceBytes = Buffer.from(sourceBase64, "base64");
  if (!isXlsFile(sourceBytes)) {
    return errorResponse("当前导出文件不是有效的 XLS", 422);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: snapshot, error: snapshotError } = await supabase
    .from("week_import_snapshots")
    .select("original_file_path")
    .eq("week_id", weekId)
    .maybeSingle();

  if (snapshotError || typeof snapshot?.original_file_path !== "string") {
    return errorResponse("没有找到当周原始文件", 409);
  }

  const { data: templateFile, error: templateError } = await supabase.storage
    .from(XLS_TEMPLATE_BUCKET)
    .download(snapshot.original_file_path);

  if (templateError || !templateFile) {
    return errorResponse("无法读取当周原始文件", 409);
  }

  const templateBytes = Buffer.from(await templateFile.arrayBuffer());
  if (templateBytes.length > MAX_FILE_BYTES) {
    return errorResponse("原始文件过大", 413);
  }
  if (!isXlsFile(templateBytes)) {
    return errorResponse("当周原始文件不是 XLS 格式", 422);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const exportKey = process.env.CLOUD_RUN_XLS_EXPORT_KEY;
    if (exportKey) headers["X-Export-Key"] = exportKey;

    const cloudRunResponse = await fetch(cloudRunUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        templateBase64: templateBytes.toString("base64"),
        sourceBase64: sourceBytes.toString("base64"),
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!cloudRunResponse.ok) {
      return errorResponse("兼容文件生成失败", 502);
    }

    const compatibleBytes = Buffer.from(await cloudRunResponse.arrayBuffer());
    if (!isXlsFile(compatibleBytes)) {
      return errorResponse("兼容服务返回了无效文件", 502);
    }

    return new Response(compatibleBytes, {
      status: 200,
      headers: {
        "Content-Type": XLS_MIME_TYPE,
        "Content-Disposition": `attachment; filename="schedule.xls"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return errorResponse("兼容导出服务暂时不可用", 502);
  } finally {
    clearTimeout(timeout);
  }
}
