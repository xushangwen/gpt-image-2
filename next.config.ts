import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // 强制 HTTPS 两年（含子域），用于 preload list。仅在生产域名启用后生效
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          // 最小化 CSP：限制 base-uri/form-action/frame-ancestors/object-src，避免常见注入。
          // 不限 script/style/connect，避免打挂 Clerk + Tailwind。如需严格 CSP 按 Clerk 文档单独加。
          { key: "Content-Security-Policy", value: "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
