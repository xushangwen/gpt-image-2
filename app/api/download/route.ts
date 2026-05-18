import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { fetchSafeUrl, parseSafeHttpUrl, UrlSafetyError } from "@/lib/url-safety";
import { HttpError } from "@/lib/errors";

const DOWNLOAD_TIMEOUT_MS = 45_000;
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

// 限制可下载来源（防止本接口被当作开放代理）。env 配置 DOWNLOAD_ALLOWED_HOSTS
// 逗号分隔；默认放行中转商域名 + Gemini/Google 官方 CDN
const DEFAULT_ALLOWED_HOSTS = [
  "tu-zi.com",
  "yunwu.ai",
  "googleapis.com",
  "googleusercontent.com",
];

function getAllowedHosts(): string[] {
  const env = process.env.DOWNLOAD_ALLOWED_HOSTS?.trim();
  if (env) return env.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  return DEFAULT_ALLOWED_HOSTS;
}

function assertHostAllowed(url: URL) {
  const host = url.hostname.toLowerCase();
  const allowed = getAllowedHosts();
  const ok = allowed.some(suffix => host === suffix || host.endsWith(`.${suffix}`));
  if (!ok) {
    throw new HttpError("不支持下载该来源的图片", 403);
  }
}

function sanitizeFilename(input: unknown) {
  const fallback = `imagegen-${Date.now()}.jpg`;
  if (typeof input !== "string" || !input.trim()) return fallback;
  const cleaned = input.trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

async function readBody(req: NextRequest) {
  try {
    return await req.json();
  } catch {
    throw new HttpError("请求体不是有效的 JSON", 400);
  }
}

function parseDownloadUrl(input: unknown) {
  if (typeof input !== "string") {
    throw new HttpError("下载地址无效", 400);
  }
  try {
    return parseSafeHttpUrl(input, "下载地址无效");
  } catch (err) {
    if (err instanceof UrlSafetyError) {
      throw new HttpError(err.message === "不支持访问内网地址" ? "不支持下载内网地址" : err.message, err.status);
    }
    throw err;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const body = await readBody(req);
    const url = parseDownloadUrl(body?.url);
    assertHostAllowed(url);
    const filename = sanitizeFilename(body?.filename);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetchSafeUrl(url, {
          signal: controller.signal,
          headers: { Accept: "image/*,*/*;q=0.8" },
        });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new HttpError("图片下载超时，请稍后重试", 504);
      }
      if (err instanceof UrlSafetyError) {
        throw new HttpError(err.message === "不支持访问内网地址" ? "不支持下载内网地址" : err.message, err.status);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new HttpError(`图片源站返回错误 ${response.status}`, 502);
    }

    // 严格只放行 image/*，删 application/octet-stream 兜底（攻击者拿下中转商可转发任意二进制）
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      throw new HttpError("下载地址返回的不是图片", 415);
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_DOWNLOAD_BYTES) {
      throw new HttpError("图片超过下载大小限制", 413);
    }

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_DOWNLOAD_BYTES) {
      throw new HttpError("图片超过下载大小限制", 413);
    }

    return new NextResponse(bytes, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[download] failed:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
