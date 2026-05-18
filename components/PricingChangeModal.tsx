"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { PRICING_ROWS } from "@/lib/pricing";

// 用户已阅读过本版公告的 LocalStorage key。
// 如果将来公告内容再有大改，把版本号 +1 即可让所有用户重新看到一次。
const ACK_KEY = "imagegen_pricing_notice_v1";

interface Props {
  /** 点击"查看套餐"时打开付款 modal；可选 */
  onOpenPayment?: () => void;
}

/**
 * 计费方式变更公告。仅首次访问时弹一次，用户点"知道了"后写入 LocalStorage 不再打扰。
 * 在 client 端读取 LocalStorage，因此不会出现 SSR 闪屏。
 */
export default function PricingChangeModal({ onOpenPayment }: Props) {
  const [open, setOpen] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try {
      const acked = localStorage.getItem(ACK_KEY);
      if (acked !== "1") setOpen(true);
    } catch {
      // Safari 私密模式 / 禁 cookie：直接显示，让用户每次都能看见
      setOpen(true);
    }
  }, []);

  // ESC 关闭 + Tab 焦点循环
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
        return;
      }
      if (e.key === "Tab" && modalRef.current) {
        const focusables = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtnRef.current?.focus();
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  function dismiss() {
    try { localStorage.setItem(ACK_KEY, "1"); } catch {}
    setOpen(false);
  }

  function dismissAndOpenPayment() {
    dismiss();
    onOpenPayment?.();
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pricing-change-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        background: "rgba(0,0,0,0.68)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget) dismiss(); }}
    >
      <div
        ref={modalRef}
        style={{
          width: "100%",
          maxWidth: 460,
          background: "var(--surface)",
          borderRadius: 14,
          boxShadow: "var(--mosaic-card-shadow)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          borderBottom: "1px solid var(--border)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: "var(--accent-dim)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}>
              <i className="ri-sparkling-2-fill" style={{ fontSize: 15, color: "var(--accent)", lineHeight: 1 }} />
            </div>
            <div>
              <div id="pricing-change-title" style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
                计费方式更新
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                让你的积分用得更精准
              </div>
            </div>
          </div>
          <button
            ref={closeBtnRef}
            onClick={dismiss}
            aria-label="关闭"
            className="action-btn ck-icon-btn"
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: "none",
              background: "linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%)",
              boxShadow: "var(--mosaic-button-shadow)",
              color: "var(--text-muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <i className="ri-close-line" style={{ fontSize: 16, lineHeight: 1 }} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 20px 20px" }}>
          <p style={{
            margin: 0,
            fontSize: 13,
            lineHeight: 1.7,
            color: "var(--text-secondary)",
          }}>
            为了同时支持 <strong style={{ color: "var(--text-primary)" }}>GPT 与 Gemini 双引擎</strong>、更高画质与分辨率，
            我们把过去"按张扣费"升级为<strong style={{ color: "var(--text-primary)" }}>按积分精细计费</strong>。
            不同模型、不同画质，消耗的积分不同，让你能更灵活地选择。
          </p>

          {/* 对照表 */}
          <div style={{
            marginTop: 14,
            padding: "12px 14px",
            borderRadius: 10,
            background: "var(--mosaic-control-bg)",
            border: "1px solid var(--border-soft)",
          }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
              <i className="ri-coins-line" style={{ fontSize: 12, color: "var(--accent)", lineHeight: 1 }} />
              每张图消耗积分
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              rowGap: 6,
              columnGap: 12,
              fontSize: 13,
              lineHeight: 1.5,
            }}>
              {PRICING_ROWS.map(row => (
                <Fragment key={row.label}>
                  <span style={{ color: "var(--text-secondary)" }}>{row.label}</span>
                  <span style={{
                    color: "var(--text-primary)",
                    fontFamily: "var(--font-space)",
                    fontWeight: 700,
                    textAlign: "right",
                  }}>
                    {row.cost}
                    <span style={{ fontWeight: 400, color: "var(--text-muted)", fontSize: 11, marginLeft: 3 }}>积分</span>
                  </span>
                </Fragment>
              ))}
            </div>
          </div>

          {/* 重点说明 */}
          <ul style={{
            margin: "14px 0 0",
            padding: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}>
            {[
              { icon: "ri-shield-check-line", color: "#34d399", text: <>套餐价格与新人 66 积分赠送 <strong style={{ color: "var(--text-primary)" }}>保持不变</strong></> },
              { icon: "ri-refresh-line", color: "#60a5fa", text: <>账户内现有积分继续有效，生成失败 <strong style={{ color: "var(--text-primary)" }}>自动返还</strong></> },
              { icon: "ri-flashlight-line", color: "#fbbf24", text: <>GPT 普通画质依然 <strong style={{ color: "var(--text-primary)" }}>1 积分 / 张</strong>，日常创作不受影响</> },
            ].map(item => (
              <li key={item.icon} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, lineHeight: 1.6, color: "var(--text-secondary)" }}>
                <i className={item.icon} style={{ fontSize: 14, color: item.color, lineHeight: 1.6, flexShrink: 0 }} />
                <span>{item.text}</span>
              </li>
            ))}
          </ul>

          {/* CTAs */}
          <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              onClick={dismiss}
              className="mosaic-primary-btn ck-primary-btn"
              style={{
                width: "100%",
                padding: "11px 0",
                borderRadius: 8,
                border: "none",
                background: "linear-gradient(180deg, var(--accent-strong) 0%, var(--accent) 100%)",
                color: "var(--btn-text)",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "var(--mosaic-primary-shadow)",
              }}
            >
              我知道了，开始创作
            </button>
            {onOpenPayment && (
              <button
                onClick={dismissAndOpenPayment}
                className="action-btn ck-btn"
                style={{
                  width: "100%",
                  padding: "9px 0",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--text-secondary)",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                查看套餐详情
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
