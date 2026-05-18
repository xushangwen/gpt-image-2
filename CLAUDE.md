@AGENTS.md
@.claude/rules/responsive.md

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目信息
- 项目名：GPT Image 2（中文 UI：ImageGen）
- 技术栈：Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4
- 认证：Clerk；数据库：Supabase (service-role)；部署：Vercel
- 图像生成：双引擎
  - OpenAI 路径 `gpt-image-2`，通过 tuzi / bltcy 两个中转商之一调用
  - Google Gemini 路径 `gemini-3.1-flash-image-preview`（直连）
- 提示词增强：`gemini-3.1-flash-lite-preview`

## 常用命令
```bash
npm run dev               # 本地开发 (Turbopack via next dev)
npm run build             # 生产构建
npm run start             # 启动生产服务
npm run provider:tuzi     # 切换中转商 → 把 .env.local.tuzi 覆盖到 .env.local
npm run provider:bltcy    # 切换中转商 → bltcy 配置
```
仓库没有 lint / test 脚本；改动后通过 `npm run build` 做类型 + 构建验证。

## 架构要点

### 鉴权与中间件
- 根中间件 `middleware.ts` 全站启用 Clerk，仅 `/sign-in(.*)` 公开；其他页面 + 全部 `/api/*` 默认要求登录。
- 登录页：`app/sign-in/[[...sign-in]]/page.tsx`；Clerk 外观/本地化集中在 `lib/clerk-appearance.ts`。
- 管理员校验：`lib/admin-auth.ts` 的 `assertAdmin()` 通过比对 Clerk 邮箱与 `ADMIN_EMAIL` 环境变量；所有 `/api/admin/*` 必须先调用它。

### 积分系统（核心业务流）
- 表：`user_credits` / `packages` / `orders` / `credit_transactions`，建表脚本见 `supabase-setup.sql`。
- 原子操作走 Supabase RPC：`deduct_credits` / `add_credits` / `confirm_order_and_grant_credits`（`SECURITY DEFINER` + `FOR UPDATE`，防并发超扣）。
- 业务封装：`lib/credits.ts`（扣减/退款/赠送，新用户首次登录自动发 66 积分）+ `lib/orders.ts`（套餐 starter/standard/value，订单号 `ORD-YYYYMMDD-XXXXXXXX`）。
- 生成路由必须按"先扣再生成失败退款"模式：扣分 → 调上游 → 失败时 `refundCredits`。两条生成路由（`/api/generate`、`/api/gemini/generate`）都遵循此模式，新增路由要保持一致。

### 图像生成路由
- `app/api/generate/route.ts`：OpenAI 系；按 `IMAGE_PROVIDER` (tuzi|bltcy|custom) 切换 endpoint 与请求格式（`PROVIDER_PRESETS` 映射 size 格式 pixel vs ratio、reference endpoint 类型 chat-completions / images-edits / images-generations）。`vercel.json` 把它固定到 `hkg1`，超时 300s。
- `app/api/gemini/generate/route.ts`：直连 Gemini；quality → `imageSize` (1K/2K/4K)，宽高比通过提示词文本引导，**禁止** `imageGenerationConfig` 字段（`gemini-*-flash-*` 不支持，会报 `Unknown name`）。固定区域 `iad1`，超时 300s。
- 公共约束：`MAX_PROMPT_LENGTH=4000`、`MAX_REFERENCE_BYTES=10MB`、参考图仅 png/jpeg/webp。
- 下载流量经 `app/api/download/route.ts` + `lib/url-safety.ts`（防 SSRF）转发，避免暴露中转商 URL。

### 前端结构
- 首页 `app/page.tsx` 是一个大 client component，集中管理生成参数 / 历史 / 版本 / lightbox / 支付 modal；类型集中在 `lib/types.ts`。
- 历史存 LocalStorage（key 见 `LS_HISTORY`），缩略图与版本切换在内存中维护，不依赖服务端。
- UI 原子组件在 `components/ui/`；业务组件直接放 `components/`。
- 字体：`Space_Grotesk` + `Noto_Sans_SC`（next/font，在 `app/layout.tsx`）；图标库：`remixicon`。

### 环境变量
关键变量（详见 `.env.local`）：
- Clerk：`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` / 登录跳转 URL
- Supabase：`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`（只在服务端用）
- 管理员：`ADMIN_EMAIL`
- 图像：`IMAGE_PROVIDER`（tuzi|bltcy|custom）+ `TUZI_API_KEY` / `BLTCY_API_KEY` / `IMAGE_MODEL`
- Gemini：`GEMINI_API_KEY` / `GEMINI_IMAGE_MODEL` / `ENHANCE_MODEL`

切换 OpenAI 中转商不要手改 `.env.local`，跑 `npm run provider:tuzi` 或 `npm run provider:bltcy`（`scripts/switch-provider.mjs` 会把对应 `.env.local.<name>` 覆盖过去）。

## 编码约束（项目特定）

### 这不是你训练数据里的 Next.js
按 `AGENTS.md` 提示：写代码前先读 `node_modules/next/dist/docs/` 里的相关 guide，API/约定可能与你记忆中的不同；留意 deprecation 提示。

### Gemini API 规范
- 图片下载前端必须 Canvas 重绘 → `toBlob('image/jpeg', 0.95)` → `createObjectURL`，后缀 `.jpg`（base64 直接下载会缺元数据，macOS QuickLook 打不开）。
- 禁止 `imageGenerationConfig`（见上）。
- 宽高比走提示词文本（如 `portrait orientation 9:16`），不要试图传未支持的 config 字段。
- API key 永远只在服务端 Route Handler 用，不出现在任何前端代码。

### 响应式
- Desktop-first，baseline 1440px；断点：mobile ≤ 768、iPad 769–1024、desktop > 1024。
- 文字溢出用 `clamp()` / `vw`，禁止 `overflow:hidden` 或 z-index hack；full-width 容器用 padding 约束内部文字，不要给容器加 `max-width`。
- 改全局 CSS / 多页面影响的样式前先说目标选择器 + 当前值 + 拟改方案，等确认再写代码。

### Git
- 问"未提交/未推送"时直接 `git status` + `git log origin/main..HEAD`。
- 完成一组改动后主动提示是否 commit + push。
