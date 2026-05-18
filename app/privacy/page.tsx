import Link from "next/link";

export const metadata = {
  title: "隐私政策 — ImageGen",
};

const LAST_UPDATED = "2026 年 5 月 18 日";

export default function PrivacyPage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text-primary)", fontFamily: "var(--font-cn), sans-serif" }}>
      <header style={{ padding: "0 24px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontSize: 14, fontWeight: 600, fontFamily: "var(--font-space)" }}>隐私政策</span>
        <Link href="/" style={{ fontSize: 12, color: "var(--text-muted)", textDecoration: "none" }}>← 返回首页</Link>
      </header>

      <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px 64px", lineHeight: 1.75, fontSize: 14 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>ImageGen 隐私政策</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 28 }}>最后更新：{LAST_UPDATED}</p>

        <Section title="1. 我们收集哪些数据">
          <ul style={ulStyle}>
            <li><strong>账户数据</strong>：通过 Clerk 收集您的邮箱地址、用户 ID 与登录方式（Google / 邮箱验证码等）。</li>
            <li><strong>积分与订单</strong>：剩余积分、累计已用、订单号、套餐选择、订单状态以及积分流水。</li>
            <li><strong>生成内容</strong>：您输入的提示词、上传的参考图（仅在单次请求过程中传给上游 API，<strong>我们不在服务器留存</strong>）。</li>
            <li><strong>本地存储</strong>：浏览器历史记录与版本缩略图存放在您本机的 LocalStorage / IndexedDB，<strong>不会上传</strong>。</li>
            <li><strong>日志</strong>：Vercel 平台会记录服务端请求日志（IP、状态码、错误信息），用于排障，按平台默认策略自动滚动删除。</li>
          </ul>
        </Section>

        <Section title="2. 数据如何使用">
          您提供的数据仅用于：
          <ul style={ulStyle}>
            <li>身份认证与防止账号被盗用；</li>
            <li>积分扣减、退款、订单对账等业务流程；</li>
            <li>调用上游图像生成 API 完成您本次的生成请求；</li>
            <li>排查问题、修复缺陷、优化产品稳定性。</li>
          </ul>
          <strong>我们不会出售您的数据，也不会用于针对您的精准广告。</strong>
        </Section>

        <Section title="3. 第三方服务">
          为提供本服务，我们使用以下第三方服务商，并依赖它们各自的隐私政策：
          <ul style={ulStyle}>
            <li><strong>Clerk</strong>（身份认证）— 处理登录、邮箱验证、Session。</li>
            <li><strong>Supabase</strong>（数据库）— 存储您的积分余额、订单与流水。</li>
            <li><strong>OpenAI</strong> 及其授权中转商 — 处理 gpt-image-2 等模型的生图请求。</li>
            <li><strong>Google Gemini</strong> — 当您选择 Gemini 引擎时处理生图请求。</li>
            <li><strong>Vercel</strong>（部署平台）— 托管前端与 API 路由，承载服务端日志。</li>
            <li><strong>微信</strong>（支付）— 用于人工对账（您主动通过微信向我们付款）。</li>
          </ul>
          以上服务商均按其商业级安全标准处理数据。我们建议您在使用前了解它们的隐私条款。
        </Section>

        <Section title="4. 数据存储位置">
          <ul style={ulStyle}>
            <li>Supabase 数据库托管在云服务商提供的境外数据中心。</li>
            <li>Clerk 身份服务托管在境外。</li>
            <li>Vercel 函数运行在指定地区（OpenAI 路由：香港；Gemini 路由：美东）。</li>
            <li>使用本服务即表示您理解并同意您的数据可能被传输至中国大陆以外的地区进行处理。</li>
          </ul>
        </Section>

        <Section title="5. 您的权利">
          您有权：
          <ul style={ulStyle}>
            <li>查看您的账户数据：登录后在右上角头像菜单中查看；</li>
            <li>要求删除您的账户与关联数据：请通过付款渠道联系管理员，处理时间通常在 7 个工作日内；</li>
            <li>导出账户数据：可联系管理员提供 CSV 形式导出。</li>
          </ul>
        </Section>

        <Section title="6. Cookie 与本地存储">
          我们使用 Cookie 维持登录状态（Clerk Session），使用 LocalStorage 保存提示词与生图历史，
          使用 IndexedDB 缓存生成结果缩略图以提升体验。这些数据您可通过浏览器设置自行清除。
        </Section>

        <Section title="7. 未成年人保护">
          本服务不面向 14 周岁以下未成年人提供。若您发现未成年人在使用本服务，请通知管理员协助处理。
        </Section>

        <Section title="8. 政策变更">
          本隐私政策可能不时更新。重要变更会通过页面弹窗等方式告知您。继续使用即视为接受更新后的政策。
        </Section>

        <Section title="9. 联系我们">
          如对本政策有疑问或希望行使上述权利，请通过付款时使用的微信渠道联系管理员。
        </Section>

        <p style={{ marginTop: 32, fontSize: 12, color: "var(--text-muted)" }}>
          相关：<Link href="/terms" style={linkStyle}>《服务条款》</Link>
        </p>
      </main>
    </div>
  );
}

const ulStyle: React.CSSProperties = {
  margin: "8px 0 0",
  paddingLeft: 20,
  color: "var(--text-secondary)",
  listStyle: "disc",
};
const linkStyle: React.CSSProperties = { color: "var(--accent)", textDecoration: "underline" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{title}</h2>
      <div style={{ color: "var(--text-secondary)" }}>{children}</div>
    </section>
  );
}
