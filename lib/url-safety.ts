import { promises as dns } from "dns";
import { isIPv4, isIPv6 } from "net";

export class UrlSafetyError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

// 把 IPv6 缩写展开为 8 段（如 "fe80::1" → "fe80:0:0:0:0:0:0:1"）
function expandIPv6(addr: string): string | null {
  if (!isIPv6(addr)) return null;
  // 含 IPv4 尾段（::ffff:1.2.3.4）由调用方先处理掉
  if (addr.includes(".")) return null;
  if (!addr.includes("::")) return addr;
  const [head, tail] = addr.split("::");
  const headSegs = head ? head.split(":") : [];
  const tailSegs = tail ? tail.split(":") : [];
  const missing = 8 - headSegs.length - tailSegs.length;
  if (missing < 0) return null;
  return [...headSegs, ...Array(missing).fill("0"), ...tailSegs].join(":");
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a >= 224 // multicast + 保留段
  );
}

function isPrivateIPv6(addr: string): boolean {
  const lower = addr.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  // IPv4-mapped: ::ffff:1.2.3.4
  const mapped = lower.match(/^::ffff:([0-9.]+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  const expanded = expandIPv6(lower);
  if (!expanded) return true; // 无法解析时保守 block
  const segs = expanded.split(":");
  if (segs.length !== 8) return true;
  const first = parseInt(segs[0], 16);
  if (Number.isNaN(first)) return true;
  // fc00::/7 unique-local（fc/fd 开头）
  if ((first & 0xfe00) === 0xfc00) return true;
  // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfe80) return true;
  // ff00::/8 multicast
  if ((first & 0xff00) === 0xff00) return true;
  // 全 0 段（::）已在上面命中
  return false;
}

function isBlockedHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;

  // [::1] / [fe80::1] / [::ffff:127.0.0.1] 形式
  if (host.startsWith("[") && host.endsWith("]")) {
    return isPrivateIPv6(host.slice(1, -1));
  }
  // 裸 IPv6（含冒号且非 host:port，由调用方保证）
  if (isIPv6(host)) {
    return isPrivateIPv6(host);
  }
  // IPv4
  if (isIPv4(host)) {
    return isPrivateIPv4(host);
  }
  // 域名 hostname：留给后续 DNS 解析校验
  return false;
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

// Resolves hostname via DNS and verifies the actual IP is not private,
// preventing DNS rebinding attacks where an attacker TTL-flips a domain to an internal IP.
// 注：lookup 与 fetch 之间仍存在毫秒级 race window（彻底消除需绑定 dispatcher，代价较大）。
async function assertResolvedIpSafe(hostname: string) {
  // 跳过 IP 字面量（已被 parseSafeHttpUrl 校验过）
  if (isIPv4(hostname) || hostname.startsWith("[") || isIPv6(hostname)) return;
  try {
    // all:true 拿到所有解析结果，全部验证一遍（防止 round-robin 中混内网 IP）
    const records = await dns.lookup(hostname, { all: true });
    for (const { address } of records) {
      if (isBlockedHost(address)) {
        throw new UrlSafetyError("不支持访问内网地址", 400);
      }
    }
  } catch (err) {
    if (err instanceof UrlSafetyError) throw err;
    throw new UrlSafetyError("域名解析失败", 400);
  }
}

export async function fetchSafeUrl(
  input: string | URL,
  init: RequestInit & { maxRedirects?: number } = {}
) {
  const { maxRedirects = 2, ...requestInit } = init;
  let currentUrl = typeof input === "string" ? parseSafeHttpUrl(input).href : parseSafeHttpUrl(input.href).href;
  let hops = 0;

  while (true) {
    await assertResolvedIpSafe(new URL(currentUrl).hostname);
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
