export class UrlSafetyError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

function isBlockedHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;

  if (host.startsWith("[") && host.endsWith("]")) {
    const inner = host.slice(1, -1);
    if (inner === "::" || inner === "::1") return true;
    if (inner.startsWith("::ffff:")) return isBlockedHost(inner.slice(7));
    if (/^(::1$|fe[89ab][0-9a-f]:|f[cd][0-9a-f]{2}:|ff[0-9a-f]{2}:)/i.test(inner)) return true;
    return false;
  }

  if (host.includes(":")) return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;

  const parts = ipv4.slice(1).map(Number);
  if (parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return true;

  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a === 0
  );
}

export function parseSafeHttpUrl(input: string, invalidMessage = "地址无效") {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UrlSafetyError(invalidMessage, 400);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UrlSafetyError("仅支持 HTTP(S) 地址", 400);
  }
  if (isBlockedHost(url.hostname)) {
    throw new UrlSafetyError("不支持访问内网地址", 400);
  }

  return url;
}

export async function fetchSafeUrl(
  input: string | URL,
  init: RequestInit & { maxRedirects?: number } = {}
) {
  const { maxRedirects = 2, ...requestInit } = init;
  let currentUrl = typeof input === "string" ? parseSafeHttpUrl(input).href : parseSafeHttpUrl(input.href).href;
  let hops = 0;

  while (true) {
    const response = await fetch(currentUrl, {
      ...requestInit,
      redirect: "manual",
    });

    if (response.status < 300 || response.status >= 400) {
      return response;
    }

    if (hops >= maxRedirects) {
      throw new UrlSafetyError("重定向次数过多", 400);
    }

    const location = response.headers.get("location");
    if (!location) {
      throw new UrlSafetyError("重定向地址无效", 400);
    }

    currentUrl = parseSafeHttpUrl(new URL(location, currentUrl).href).href;
    hops++;
  }
}
