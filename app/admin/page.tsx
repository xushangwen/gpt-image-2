"use client";

import { useState, useEffect, useCallback } from "react";
import { PACKAGES } from "@/lib/orders";

interface Order {
  id: string;
  user_id: string;
  email: string;
  package_id: string;
  status: string;
  created_at: string;
  confirmed_at?: string;
  confirmed_by?: string;
}

interface UserCredits {
  user_id: string;
  email: string;
  credits_remaining: number;
  total_used: number;
}

export default function AdminPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [users, setUsers] = useState<UserCredits[]>([]);
  const [tab, setTab] = useState<"orders" | "users">("orders");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [pendingRes, usersRes] = await Promise.all([
        fetch("/api/admin/orders"),
        fetch("/api/admin/users"),
      ]);

      if (pendingRes.ok) {
        const data = await pendingRes.json();
        setOrders(data.orders ?? []);
      } else {
        const data = await pendingRes.json();
        setError(data.error ?? "订单加载失败");
      }

      if (usersRes?.ok) {
        const data = await usersRes.json();
        setUsers(data.users ?? []);
      } else if (usersRes) {
        const data = await usersRes.json();
        setError(data.error ?? "无权限访问");
      }
    } catch {
      setError("加载失败，请检查网络");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleConfirm(orderId: string) {
    setConfirming(orderId);
    try {
      const res = await fetch("/api/admin/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: orderId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "操作失败");
      showToast(`✓ 订单 ${orderId} 已确认，积分已到账`);
      await fetchData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "操作失败");
    } finally {
      setConfirming(null);
    }
  }

  const pendingOrders = orders.filter(o => o.status === "pending");
  const confirmedOrders = orders.filter(o => o.status !== "pending");

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", color: "var(--text-secondary)", fontSize: 14 }}>
        加载中...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--bg)", gap: 12 }}>
        <div style={{ fontSize: 14, color: "#f87171" }}>{error}</div>
        <a href="/" style={{ fontSize: 13, color: "var(--text-muted)" }}>返回首页</a>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text-primary)", fontFamily: "var(--font-cn), sans-serif" }}>
      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999, padding: "10px 20px", borderRadius: 8, background: "#1a1a1a", border: "1px solid #333", fontSize: 13, color: "#f5f5f5", whiteSpace: "nowrap" }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <header className="ck-app-header" style={{ padding: "0 24px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)", background: "var(--bg)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600, fontFamily: "var(--font-space)" }}>管理后台</span>
          {pendingOrders.length > 0 && (
            <span className="ck-pill" style={{ fontSize: 11, padding: "2px 7px", borderRadius: "var(--ck-radius-round)", background: "#fb923c22", border: "1px solid rgba(251,146,60,0.4)", color: "#fb923c", fontFamily: "var(--font-space)" }}>
              {pendingOrders.length} 待处理
            </span>
          )}
        </div>
        <a className="ck-btn" href="/" style={{ display: "inline-flex", alignItems: "center", minHeight: 32, padding: "0 12px", fontSize: 12, color: "var(--text-muted)", textDecoration: "none" }}>← 返回首页</a>
      </header>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 24px" }}>
        {/* Tabs */}
        <div className="ck-segmented" style={{ display: "flex", gap: 0, marginBottom: 20, padding: 0, borderRadius: 8, background: "var(--surface)", border: "none", width: "fit-content" }}>
          {(["orders", "users"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              data-active={tab === t}
              style={{
                padding: "6px 16px",
                borderRadius: 7,
                border: "none",
                background: "transparent",
                color: tab === t ? "var(--accent)" : "var(--text-muted)",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {t === "orders" ? `订单 (${pendingOrders.length} 待处理)` : `用户 (${users.length})`}
            </button>
          ))}
        </div>

        {/* Orders Tab */}
        {tab === "orders" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Pending */}
            <section>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 10, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                待处理订单
              </div>
              {pendingOrders.length === 0 ? (
                <div className="ck-data-row" style={{ padding: "24px", textAlign: "center", borderRadius: 8, border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 13 }}>
                  暂无待处理订单
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {pendingOrders.map(order => {
                    const pkg = PACKAGES.find(p => p.id === order.package_id);
                    return (
                      <div key={order.id} className="ck-data-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderRadius: 8, border: "1.5px solid rgba(251,146,60,0.3)", background: "rgba(251,146,60,0.04)" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--font-space)", letterSpacing: "0.04em", color: "var(--text-primary)" }}>
                              {order.id}
                            </span>
                            <span className="ck-pill" style={{ fontSize: 11, padding: "2px 7px", borderRadius: "var(--ck-radius-round)", background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.3)", color: "#fb923c" }}>
                              {pkg?.name ?? order.package_id} ¥{pkg?.price_yuan} · {pkg?.credits} 张
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                            {order.email} · {new Date(order.created_at).toLocaleString("zh-CN")}
                          </div>
                        </div>
                        <button
                          className="ck-primary-btn"
                          onClick={() => handleConfirm(order.id)}
                          disabled={confirming === order.id}
                          style={{
                            padding: "8px 16px",
                            borderRadius: 8,
                            border: "none",
                            background: confirming === order.id ? "var(--border)" : "var(--text-primary)",
                            color: confirming === order.id ? "var(--text-muted)" : "var(--bg)",
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: confirming === order.id ? "not-allowed" : "pointer",
                            transition: "all 0.15s",
                            flexShrink: 0,
                          }}
                        >
                          {confirming === order.id ? "处理中..." : "确认到账"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Confirmed */}
            {confirmedOrders.length > 0 && (
              <section>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 10, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  已处理
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {confirmedOrders.map(order => {
                    const pkg = PACKAGES.find(p => p.id === order.package_id);
                    return (
                      <div key={order.id} className="ck-data-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderRadius: 8, border: "1px solid var(--border)", opacity: 0.7 }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <div style={{ fontSize: 13, fontFamily: "var(--font-space)", fontWeight: 600 }}>
                            {order.id}
                          </div>
                          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                            {order.email} · {pkg?.name} ¥{pkg?.price_yuan}
                          </div>
                        </div>
                        <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: "var(--ck-radius-round)", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)", color: "#4ade80" }}>
                          已到账
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}

        {/* Users Tab */}
        {tab === "users" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {users.map(u => (
              <div key={u.user_id} className="ck-data-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)" }}>
                <div style={{ fontSize: 13, color: "var(--text-primary)" }}>{u.email}</div>
                <div style={{ display: "flex", gap: 16, fontSize: 12, fontFamily: "var(--font-space)" }}>
                  <span style={{ color: u.credits_remaining <= 10 ? "#fb923c" : "var(--text-secondary)" }}>
                    余 {u.credits_remaining} 张
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>已用 {u.total_used}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
