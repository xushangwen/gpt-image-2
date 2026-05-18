"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { PACKAGES, type PackageId } from "@/lib/orders";
import { PRICING_ROWS } from "@/lib/pricing";

interface Props {
  currentCredits: number;
  onClose: () => void;
  onOrderCreated: () => void;
}

type Step = "select" | "qr";

export default function PaymentModal({ currentCredits, onClose, onOrderCreated }: Props) {
  const [selectedPkg, setSelectedPkg] = useState<PackageId>("standard");
  const [step, setStep] = useState<Step>("select");
  const [orderId, setOrderId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [agreed, setAgreed] = useState(false);

  const modalRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // ESC 关闭 + Tab 焦点循环（focus trap）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab" && modalRef.current) {
        // :not(:disabled) 防 trap 卡在 disabled 按钮（如 loading 状态下的 "生成订单"）
        const focusables = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
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
  }, [onClose]);

  // 锁背景滚动 + 打开时把焦点送进 modal
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtnRef.current?.focus();
    return () => { document.body.style.overflow = prev; };
  }, []);

  async function handleCreateOrder() {
    if (!agreed) {
      setError("请先勾选同意服务条款与隐私政策");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package_id: selectedPkg }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "创建订单失败");
      setOrderId(data.order_id);
      setStep("qr");
      onOrderCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建订单失败");
    } finally {
      setLoading(false);
    }
  }

  const pkg = PACKAGES.find(p => p.id === selectedPkg)!;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-modal-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.68)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={modalRef} style={{
        width: "100%",
        maxWidth: 420,
        background: "var(--surface)",
        borderRadius: 12,
        border: "none",
        boxShadow: "var(--mosaic-card-shadow)",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          borderBottom: "1px solid var(--border)",
        }}>
          <div>
            <div id="payment-modal-title" style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
              {step === "select" ? "购买积分" : "完成付款"}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 4 }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>当前余额</span>
              <span style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-space)", lineHeight: 1 }}>{currentCredits}</span>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>积分</span>
            </div>
          </div>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            aria-label="关闭"
            className="action-btn ck-icon-btn"
            style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: "linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%)", boxShadow: "var(--mosaic-button-shadow)", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <i className="ri-close-line" style={{ fontSize: 16, lineHeight: 1 }} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 20 }}>
          {step === "select" ? (
            <>
              {/* Package cards */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {PACKAGES.map(p => {
                  const active = selectedPkg === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedPkg(p.id)}
                      className="ck-option-card"
                      data-active={active}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "14px 16px",
                        borderRadius: 8,
                        border: "1px solid",
                        borderColor: active ? "var(--accent)" : "var(--border)",
                        background: active ? "var(--accent-dim)" : "var(--mosaic-control-bg)",
                        boxShadow: active ? "var(--mosaic-primary-shadow)" : "var(--mosaic-button-shadow)",
                        cursor: "pointer",
                        transition: "all 0.15s",
                        textAlign: "left",
                        width: "100%",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
                          {p.name}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
                          {p.credits} 积分 · <strong style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{(p.price_yuan / p.credits).toFixed(2)}</strong> 元/积分
                        </div>
                      </div>
                      <div style={{
                        fontSize: 20,
                        fontWeight: 700,
                        color: active ? "var(--accent)" : "var(--text-primary)",
                        fontFamily: "var(--font-space)",
                      }}>
                        ¥{p.price_yuan}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* 积分消耗对照表 */}
              <div style={{
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 8,
                background: "var(--mosaic-control-bg)",
                border: "1px solid var(--border-soft)",
              }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
                  <i className="ri-coins-line" style={{ fontSize: 12, lineHeight: 1 }} />
                  积分如何使用（每张图消耗）
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", rowGap: 4, columnGap: 8, fontSize: 12, lineHeight: 1.5 }}>
                  {PRICING_ROWS.map(row => (
                    <Fragment key={row.label}>
                      <span style={{ color: "var(--text-secondary)" }}>{row.label}</span>
                      <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-space)", fontWeight: 600, textAlign: "right" }}>
                        {row.cost} 积分
                      </span>
                    </Fragment>
                  ))}
                </div>
                <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  生成失败积分自动返还 · 同一套餐金额，不同模型可生成的图片数量不同
                </div>
              </div>

              {error && (
                <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", fontSize: 13, color: "#f87171" }}>
                  {error}
                </div>
              )}

              {/* 服务条款勾选 */}
              <label
                style={{
                  marginTop: 16,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid",
                  borderColor: agreed ? "var(--accent)" : "var(--border)",
                  background: agreed ? "var(--accent-dim)" : "var(--mosaic-control-bg)",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => { setAgreed(e.target.checked); if (e.target.checked) setError(""); }}
                  style={{
                    width: 16,
                    height: 16,
                    marginTop: 1,
                    cursor: "pointer",
                    accentColor: "var(--accent)",
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 12, lineHeight: 1.6, color: "var(--text-secondary)" }}>
                  我已阅读并同意
                  <a href="/terms" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                    style={{ color: "var(--accent)", textDecoration: "underline", margin: "0 2px" }}>《服务条款》</a>
                  与
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                    style={{ color: "var(--accent)", textDecoration: "underline", margin: "0 2px" }}>《隐私政策》</a>
                  ；理解积分一经发放不支持人民币退款，但生成失败积分自动返还。
                </span>
              </label>

              <button
                onClick={handleCreateOrder}
                disabled={loading || !agreed}
                className="mosaic-primary-btn ck-primary-btn"
                style={{
                  marginTop: 12,
                  width: "100%",
                  padding: "12px 0",
                  borderRadius: 6,
                  border: "none",
                  background: (loading || !agreed)
                    ? "var(--border)"
                    : "linear-gradient(180deg, var(--accent-strong) 0%, var(--accent) 100%)",
                  color: (loading || !agreed) ? "var(--text-muted)" : "var(--btn-text)",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: (loading || !agreed) ? "not-allowed" : "pointer",
                  transition: "all 0.15s",
                  boxShadow: (loading || !agreed) ? "none" : "var(--mosaic-primary-shadow)",
                }}
              >
                {loading ? "生成中..." : `生成订单 · ¥${pkg.price_yuan}`}
              </button>

              <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
                人工审核到账，工作时间内 30 分钟内处理
              </div>
            </>
          ) : (
            <>
              {/* QR code step */}
              <div style={{ textAlign: "center" }}>
                {/* QR image */}
                <div style={{
                  width: 200,
                  height: 200,
                  margin: "0 auto 16px",
                  borderRadius: 12,
                  overflow: "hidden",
                  border: "1px solid var(--border)",
                  background: "#fff",
                }}>
                  <img
                    src="/wechat-qr.jpg"
                    alt="微信收款码"
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                </div>

                {/* Order number */}
                <div style={{
                  padding: "12px 16px",
                  borderRadius: 8,
                  background: "var(--surface-2, var(--bg))",
                  border: "1px solid var(--border)",
                  marginBottom: 16,
                }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
                    订单号（转账备注必填）
                  </div>
                  <div style={{
                    fontSize: 18,
                    fontWeight: 700,
                    fontFamily: "var(--font-space)",
                    letterSpacing: "0.04em",
                    color: "var(--text-primary)",
                  }}>
                    {orderId}
                  </div>
                </div>

                <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 16 }}>
                  微信扫码支付 <strong>¥{pkg.price_yuan}</strong>（{pkg.credits} 积分）<br />
                  <span style={{ color: "var(--accent)", fontWeight: 600 }}>
                    转账时请在备注填写订单号
                  </span>
                  ，否则无法自动匹配
                </div>

                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  付款后请等待人工审核，积分到账后页面自动更新
                </div>
              </div>

              <button
                onClick={onClose}
                className="action-btn ck-btn"
                style={{
                  marginTop: 20,
                  width: "100%",
                  padding: "12px 0",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--text-primary)",
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                关闭，等待到账
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
