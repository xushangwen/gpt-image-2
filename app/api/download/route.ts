import { NextRequest, NextResponse } from "next/server";

const DOWNLOAD_TIMEOUT_MS = 45_000;
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

class HttpError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
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

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new HttpError("下载地址无效", 400);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new HttpError("仅支持 HTTP(S) 图片下载", 400);
  }
  if (isBlockedHost(url.hostname)) {
    throw new HttpError("不支持下载内网地址", 400);
  }

  return url;
}

function isBlockedHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;

  // IPv6 in bracket notation
  if (host.startsWith("[") && host.endsWith("]")) {
    const inner = host.slice(1, -1);
    if (inner === "::" || inner === "::1") return true;
    // IPv4-mapped: ::ffff:a.b.c.d
    if (inner.startsWith("::ffff:")) return isBlockedHost(inner.slice(7));
    // Loopback, ULA (fc00::/7), link-local (fe80::/10)
    if (/^(::1$|fe[89ab][0-9a-f]:|f[cd][0-9a-f]{2}:)/i.test(inner)) return true;
    return false;
  }

  // Bare IPv6 (no brackets) — treat as blocked for safety
  if (host.includes(":")) return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;

  const parts = ipv4.slice(1).map(Number);
  if (parts.some(part => Number.isNaN(part) || part < 0 || part > 255)) return true;

  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 0)
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req);
    const url = parseDownloadUrl(body?.url);
    const filename = sanitizeFilename(body?.filename);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "image/*,*/*;q=0.8" },
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new HttpError("图片下载超时，请稍后重试", 504);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new HttpError(`图片源站返回错误 ${response.status}`, 502);
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    if (!contentType.startsWith("image/") && contentType !== "application/octet-stream") {
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
        "Content-Disposition": `attachment; filename="${filename}"`,
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
