import Link from "next/link";

export const metadata = {
  title: "服务条款 — ImageGen",
};

const LAST_UPDATED = "2026 年 5 月 18 日";

export default function TermsPage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text-primary)", fontFamily: "var(--font-cn), sans-serif" }}>
      <header style={{ padding: "0 24px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontSize: 14, fontWeight: 600, fontFamily: "var(--font-space)" }}>服务条款</span>
        <Link href="/" style={{ fontSize: 12, color: "var(--text-muted)", textDecoration: "none" }}>← 返回首页</Link>
      </header>

      <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px 64px", lineHeight: 1.75, fontSize: 14 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>ImageGen 服务条款</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 28 }}>最后更新：{LAST_UPDATED}</p>

        <Section title="1. 服务说明">
          ImageGen（"本服务"）是一个基于 AI 模型的图像生成工具，通过整合 OpenAI、Google
          以及其他第三方图像生成 API 为登录用户提供文本到图像、参考图到图像等创作能力。
          本服务以积分（"生图次数"）为计价单位，单次生成消耗一定数量的积分。
        </Section>

        <Section title="2. 账号与权限">
          您需通过我们的认证服务（Clerk）登录后方可使用本服务。您应妥善保管账号凭证，
          因账号被他人使用所产生的一切后果由您自行承担。我们有权在发现违规行为时暂停或终止账号。
        </Section>

        <Section title="3. 积分与支付">
          <ul style={ulStyle}>
            <li>新用户登录后自动获得 66 张生图次数（具体数额以系统当时配置为准）。</li>
            <li>额外积分可通过购买套餐获得，目前支持微信扫码人工对账，订单号为对账唯一凭证。</li>
            <li>积分一经发放，不支持折算为人民币退款；但<strong>生成失败的请求积分会自动退还</strong>。</li>
            <li>若你长期未付款或填错订单备注，订单可能被管理员手动取消，未付款不扣积分。</li>
            <li>系统会在订单创建后 7 天仍处于未付款状态时自动取消该订单。</li>
          </ul>
        </Section>

        <Section title="4. 用户行为规范">
          您承诺<strong>不会</strong>使用本服务生成、传播或下载包含以下内容的图像：
          <ul style={ulStyle}>
            <li>违反中国大陆地区法律法规、公序良俗、社会主义核心价值观的内容；</li>
            <li>侵犯他人知识产权、肖像权、名誉权或其他合法权益的内容；</li>
            <li>色情、暴力、血腥、恐怖、歧视、骚扰等不适宜内容；</li>
            <li>虚假信息、深度伪造（Deepfake）等可能误导公众的内容；</li>
            <li>儿童不宜或涉及未成年人色情、暴力的内容。</li>
          </ul>
          上游 API 提供方（OpenAI / Google 等）已内置内容安全过滤，触发后将拒绝生成；
          多次触发可能导致账号被永久封禁，且不退还剩余积分。
        </Section>

        <Section title="5. 生成结果与知识产权">
          您对您输入的提示词与参考图保留全部知识产权。生成的图像可用于个人和商业用途，
          但请注意：<strong>AI 生成内容在不同司法辖区的版权归属仍存争议</strong>，
          且若提示词或参考图本身涉及他人作品，您需自行承担侵权风险。
          我们不对生成内容的版权归属、可用性、商用安全性作出任何担保。
        </Section>

        <Section title="6. 服务可用性">
          本服务底层依赖多个第三方 API（OpenAI、Google Gemini、中转服务商等），
          这些上游服务可能因配额耗尽、限流、服务故障等原因导致生图失败或延迟。
          我们会尽合理努力维持服务稳定，但<strong>不保证 100% 可用</strong>。
          因此类不可抗力造成的损失，您同意我们仅以"自动退还本次生成的积分"作为补偿，
          不承担其他责任。
        </Section>

        <Section title="7. 隐私保护">
          请参阅我们的<Link href="/privacy" style={linkStyle}>《隐私政策》</Link>了解我们如何处理您的数据。
        </Section>

        <Section title="8. 条款变更">
          我们可能不时修改本条款，重要变更会在首页或弹窗提示。修改后继续使用本服务即视为接受新条款。
        </Section>

        <Section title="9. 联系我们">
          如对本条款有任何疑问，可通过你购买积分时使用的微信渠道联系管理员。
        </Section>
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
