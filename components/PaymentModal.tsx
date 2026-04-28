"use client";

import { useState } from "react";
import { PACKAGES, type PackageId } from "@/lib/orders";

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

  async function handleCreateOrder() {
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
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: "100%",
        maxWidth: 420,
        background: "var(--surface)",
        borderRadius: 16,
        border: "1px solid var(--border)",
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
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
              {step === "select" ? "购买生图次数" : "完成付款"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              当前余额：{currentCredits} 张
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
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
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "14px 16px",
                        borderRadius: 10,
                        border: `1.5px solid ${active ? "var(--accent)" : "var(--border)"}`,
                        background: active ? "var(--accent-dim)" : "transparent",
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
                          {p.credits} 张 · {(p.price_yuan / p.credits * 100).toFixed(0)} 分/张
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

              {error && (
                <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", fontSize: 13, color: "#f87171" }}>
                  {error}
                </div>
              )}

              <button
                onClick={handleCreateOrder}
                disabled={loading}
                style={{
                  marginTop: 16,
                  width: "100%",
                  padding: "12px 0",
                  borderRadius: 8,
                  border: "none",
                  background: "var(--accent)",
                  color: "var(--btn-text)",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: loading ? "not-allowed" : "pointer",
                  opacity: loading ? 0.6 : 1,
                  transition: "opacity 0.15s",
                  boxShadow: "rgba(253,114,36,0.5) 0px 0px 0px 1px, rgba(255,255,255,0.07) 0px 1px 1px inset, rgba(34,42,53,0.2) 0px 2px 3px",
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
                  borderRadius: 10,
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
                  微信扫码支付 <strong>¥{pkg.price_yuan}</strong>（{pkg.credits} 张）<br />
                  <span style={{ color: "var(--accent, #fb923c)", fontWeight: 600 }}>
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
                style={{
                  marginTop: 20,
                  width: "100%",
                  padding: "12px 0",
                  borderRadius: 10,
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
