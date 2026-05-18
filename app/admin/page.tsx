"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { PACKAGES } from "@/lib/orders";

const CANCEL_REASONS = [
  "用户未付款",
  "重复下单",
  "测试单",
  "用户要求取消",
  "备注信息错误",
  "其他",
] as const;
type CancelReason = (typeof CANCEL_REASONS)[number];

const ADJUST_REASONS = [
  "客诉补偿",
  "活动赠送",
  "误扣回退",
  "其他",
] as const;
type AdjustReason = (typeof ADJUST_REASONS)[number];

const REFRESH_INTERVAL_MS = 30_000;

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

interface Transaction {
  id: number;
  user_id: string;
  type: string;
  credits_delta: number;
  order_id: string | null;
  note: string | null;
  granted_by: string | null;
  created_at: string;
}

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadCSV(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows.map(row => row.map(csvEscape).join(",")).join("\n");
  // 加 BOM，Excel 打开中文不乱码
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// "x 秒前"显示组件：把每秒时钟订阅限制在自己内部，避免父组件全量 re-render
function RelativeTime({ from }: { from: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <>{relativeTime(from, now)}</>;
}

function relativeTime(fromMs: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - fromMs) / 1000));
  if (sec < 5) return "刚刚";
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  return `${hr} 小时前`;
}

const TX_TYPE_META: Record<string, { label: string; color: string }> = {
  welcome_bonus: { label: "新人赠送", color: "#60a5fa" },
  purchase:      { label: "充值",     color: "#4ade80" },
  generation:    { label: "生成扣减", color: "#94a3b8" },
  refund:        { label: "失败退款", color: "#fb923c" },
  admin_adjust:  { label: "管理员调整", color: "#a78bfa" },
};

export default function AdminPage() {
  // data
  const [orders, setOrders] = useState<Order[]>([]);
  const [users, setUsers] = useState<UserCredits[]>([]);
  const [tab, setTab] = useState<"orders" | "users">("orders");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const [lastRefreshAt, setLastRefreshAt] = useState<number>(Date.now());

  // order ops
  const [confirming, setConfirming] = useState<string | null>(null);
  const [cancellingTarget, setCancellingTarget] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState<CancelReason | "">("");
  const [cancelSubmitting, setCancelSubmitting] = useState(false);

  // user ops: expanded transactions + adjust credits
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingTx, setLoadingTx] = useState(false);
  const [adjustingUser, setAdjustingUser] = useState<UserCredits | null>(null);
  const [adjustSign, setAdjustSign] = useState<1 | -1>(1);
  const [adjustAmount, setAdjustAmount] = useState<string>("");
  const [adjustReason, setAdjustReason] = useState<AdjustReason | "">("");
  const [adjustSubmitting, setAdjustSubmitting] = useState(false);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showToast(msg: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => setToast(""), 3000);
  }

  const fetchData = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    setRefreshing(true);
    setError("");
    try {
      const [ordersRes, usersRes] = await Promise.all([
        fetch("/api/admin/orders"),
        fetch("/api/admin/users"),
      ]);
      if (ordersRes.ok) {
        const data = await ordersRes.json();
        setOrders(data.orders ?? []);
      } else {
        const data = await ordersRes.json().catch(() => ({}));
        setError(data.error ?? "订单加载失败");
      }
      if (usersRes.ok) {
        const data = await usersRes.json();
        setUsers(data.users ?? []);
      } else {
        const data = await usersRes.json().catch(() => ({}));
        setError(data.error ?? "用户加载失败");
      }
      setLastRefreshAt(Date.now());
    } catch {
      setError("加载失败，请检查网络");
    } finally {
      if (initial) setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // 初次加载
  useEffect(() => { fetchData(true); }, [fetchData]);

  // 30s 自动轮询（静默刷新）
  useEffect(() => {
    const id = setInterval(() => { fetchData(false); }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  // 「x 秒前」展示已迁到 RelativeTime 子组件，避免每秒触发整个 750 行 admin 重渲

  // 拉某用户流水
  const fetchTransactions = useCallback(async (userId: string) => {
    setLoadingTx(true);
    try {
      const res = await fetch(`/api/admin/transactions?user_id=${encodeURIComponent(userId)}`);
      if (res.ok) {
        const data = await res.json();
        setTransactions(data.transactions ?? []);
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error ?? "流水加载失败");
        setTransactions([]);
      }
    } catch {
      showToast("流水加载失败");
      setTransactions([]);
    } finally {
      setLoadingTx(false);
    }
  }, []);

  function toggleExpandUser(userId: string) {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
      setTransactions([]);
    } else {
      setExpandedUserId(userId);
      fetchTransactions(userId);
    }
  }

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

  function openCancelDialog(order: Order) {
    setCancellingTarget(order);
    setCancelReason("");
  }
  function closeCancelDialog() {
    if (cancelSubmitting) return;
    setCancellingTarget(null);
    setCancelReason("");
  }
  async function handleCancelSubmit() {
    if (!cancellingTarget || !cancelReason) return;
    setCancelSubmitting(true);
    try {
      const res = await fetch("/api/admin/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: cancellingTarget.id, reason: cancelReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "取消失败");
      showToast(`✓ 订单 ${cancellingTarget.id} 已取消`);
      setCancellingTarget(null);
      setCancelReason("");
      await fetchData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "取消失败");
    } finally {
      setCancelSubmitting(false);
    }
  }

  function openAdjustDialog(user: UserCredits, sign: 1 | -1) {
    setAdjustingUser(user);
    setAdjustSign(sign);
    setAdjustAmount("");
    setAdjustReason("");
  }
  function closeAdjustDialog() {
    if (adjustSubmitting) return;
    setAdjustingUser(null);
    setAdjustAmount("");
    setAdjustReason("");
  }
  async function handleAdjustSubmit() {
    if (!adjustingUser || !adjustReason) return;
    const amount = parseInt(adjustAmount, 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("请输入正整数");
      return;
    }
    if (amount > 100000) {
      showToast("单次调整不能超过 100000");
      return;
    }
    setAdjustSubmitting(true);
    try {
      const delta = amount * adjustSign;
      const res = await fetch("/api/admin/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: adjustingUser.user_id,
          delta,
          reason: adjustReason,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "调整失败");
      showToast(`✓ ${adjustingUser.email} 积分已${adjustSign > 0 ? "增加" : "扣减"} ${amount}，当前余额 ${data.new_balance}`);
      setAdjustingUser(null);
      setAdjustAmount("");
      setAdjustReason("");
      await fetchData();
      if (expandedUserId === adjustingUser.user_id) {
        fetchTransactions(adjustingUser.user_id);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "调整失败");
    } finally {
      setAdjustSubmitting(false);
    }
  }

  // 搜索过滤
  const lowerSearch = search.trim().toLowerCase();
  const matches = (text: string | undefined) => !!text && text.toLowerCase().includes(lowerSearch);

  const filteredOrders = useMemo(() => {
    if (!lowerSearch) return orders;
    return orders.filter(o => matches(o.id) || matches(o.email) || matches(o.package_id));
  }, [orders, lowerSearch]);

  const filteredUsers = useMemo(() => {
    if (!lowerSearch) return users;
    return users.filter(u => matches(u.email) || matches(u.user_id));
  }, [users, lowerSearch]);

  const pendingOrders = filteredOrders.filter(o => o.status === "pending");
  const confirmedOrders = filteredOrders.filter(o => o.status === "confirmed");
  const cancelledOrders = filteredOrders.filter(o => o.status === "cancelled");

  const totalPending = orders.filter(o => o.status === "pending").length;

  function exportOrders() {
    const rows: (string | number | null | undefined)[][] = [
      ["订单号", "邮箱", "套餐", "金额", "积分", "状态", "创建时间", "处理时间", "处理人/原因"],
    ];
    for (const o of filteredOrders) {
      const pkg = PACKAGES.find(p => p.id === o.package_id);
      rows.push([
        o.id,
        o.email,
        pkg?.name ?? o.package_id,
        pkg?.price_yuan ?? "",
        pkg?.credits ?? "",
        o.status,
        new Date(o.created_at).toLocaleString("zh-CN"),
        o.confirmed_at ? new Date(o.confirmed_at).toLocaleString("zh-CN") : "",
        o.confirmed_by ?? "",
      ]);
    }
    downloadCSV(`orders-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  }

  function exportUsers() {
    const rows: (string | number | null | undefined)[][] = [
      ["邮箱", "user_id", "剩余积分", "累计已用"],
    ];
    for (const u of filteredUsers) {
      rows.push([u.email, u.user_id, u.credits_remaining, u.total_used]);
    }
    downloadCSV(`users-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  }

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

  const searchPlaceholder = tab === "orders" ? "搜索订单号 / 邮箱 / 套餐" : "搜索邮箱 / user_id";

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text-primary)", fontFamily: "var(--font-cn), sans-serif" }}>
      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999, padding: "10px 20px", borderRadius: 8, background: "#1a1a1a", border: "1px solid #333", fontSize: 13, color: "#f5f5f5", whiteSpace: "nowrap", maxWidth: "90vw", overflow: "hidden", textOverflow: "ellipsis" }}>
          {toast}
        </div>
      )}

      {/* Cancel dialog */}
      {cancellingTarget && (() => {
        const pkg = PACKAGES.find(p => p.id === cancellingTarget.package_id);
        return (
          <div
            onClick={(e) => { if (e.target === e.currentTarget) closeCancelDialog(); }}
            style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.68)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          >
            <div style={{ width: "100%", maxWidth: 420, background: "var(--surface)", borderRadius: 12, boxShadow: "var(--mosaic-card-shadow)", overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>取消订单</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>该操作不可撤销</div>
              </div>
              <div style={{ padding: 20 }}>
                <div style={{ padding: "12px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--mosaic-control-bg)", marginBottom: 14 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--font-space)", letterSpacing: "0.04em", color: "var(--text-primary)" }}>{cancellingTarget.id}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{cancellingTarget.email} · {pkg?.name} ¥{pkg?.price_yuan}</div>
                </div>
                <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 8 }}>取消原因（必选）</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {CANCEL_REASONS.map(reason => {
                    const active = cancelReason === reason;
                    return (
                      <button key={reason} type="button" onClick={() => setCancelReason(reason)} disabled={cancelSubmitting}
                        style={{ padding: "8px 14px", borderRadius: 999, border: "1px solid", borderColor: active ? "var(--accent)" : "var(--border)", background: active ? "var(--accent-dim)" : "var(--mosaic-control-bg)", color: active ? "var(--accent)" : "var(--text-secondary)", fontSize: 13, fontWeight: active ? 600 : 500, cursor: cancelSubmitting ? "not-allowed" : "pointer", transition: "all 0.15s" }}>
                        {reason}
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button onClick={closeCancelDialog} disabled={cancelSubmitting}
                    style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-primary)", fontSize: 13, fontWeight: 500, cursor: cancelSubmitting ? "not-allowed" : "pointer" }}>返回</button>
                  <button onClick={handleCancelSubmit} disabled={cancelSubmitting || !cancelReason}
                    style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: (cancelSubmitting || !cancelReason) ? "var(--border)" : "#dc2626", color: (cancelSubmitting || !cancelReason) ? "var(--text-muted)" : "#fff", fontSize: 13, fontWeight: 600, cursor: (cancelSubmitting || !cancelReason) ? "not-allowed" : "pointer", transition: "all 0.15s" }}>
                    {cancelSubmitting ? "处理中..." : "确认取消"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Adjust credits dialog */}
      {adjustingUser && (() => {
        const isPlus = adjustSign > 0;
        return (
          <div
            onClick={(e) => { if (e.target === e.currentTarget) closeAdjustDialog(); }}
            style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.68)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          >
            <div style={{ width: "100%", maxWidth: 440, background: "var(--surface)", borderRadius: 12, boxShadow: "var(--mosaic-card-shadow)", overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
                  {isPlus ? "增加积分" : "扣减积分"}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                  会写入流水表，可在用户行展开查看
                </div>
              </div>
              <div style={{ padding: 20 }}>
                <div style={{ padding: "12px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--mosaic-control-bg)", marginBottom: 14 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{adjustingUser.email}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, fontFamily: "var(--font-space)" }}>
                    当前余额 {adjustingUser.credits_remaining} · 累计已用 {adjustingUser.total_used}
                  </div>
                </div>

                <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
                  调整数量（正整数，最大 100000）
                </label>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
                  <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
                    <button type="button" onClick={() => setAdjustSign(1)} disabled={adjustSubmitting}
                      style={{ padding: "8px 14px", border: "none", background: adjustSign === 1 ? "#4ade80" : "transparent", color: adjustSign === 1 ? "#0f0f0f" : "var(--text-muted)", fontSize: 13, fontWeight: 600, cursor: adjustSubmitting ? "not-allowed" : "pointer", transition: "all 0.15s" }}>
                      + 增加
                    </button>
                    <button type="button" onClick={() => setAdjustSign(-1)} disabled={adjustSubmitting}
                      style={{ padding: "8px 14px", border: "none", background: adjustSign === -1 ? "#dc2626" : "transparent", color: adjustSign === -1 ? "#fff" : "var(--text-muted)", fontSize: 13, fontWeight: 600, cursor: adjustSubmitting ? "not-allowed" : "pointer", transition: "all 0.15s" }}>
                      − 扣减
                    </button>
                  </div>
                  <input
                    type="number" inputMode="numeric" min={1} max={100000}
                    value={adjustAmount}
                    onChange={e => setAdjustAmount(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                    placeholder="例如 50"
                    disabled={adjustSubmitting}
                    style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--mosaic-control-bg)", color: "var(--text-primary)", fontSize: 14, fontFamily: "var(--font-space)", outline: "none" }}
                  />
                </div>

                <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 8 }}>原因（必选）</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {ADJUST_REASONS.map(reason => {
                    const active = adjustReason === reason;
                    return (
                      <button key={reason} type="button" onClick={() => setAdjustReason(reason)} disabled={adjustSubmitting}
                        style={{ padding: "8px 14px", borderRadius: 999, border: "1px solid", borderColor: active ? "var(--accent)" : "var(--border)", background: active ? "var(--accent-dim)" : "var(--mosaic-control-bg)", color: active ? "var(--accent)" : "var(--text-secondary)", fontSize: 13, fontWeight: active ? 600 : 500, cursor: adjustSubmitting ? "not-allowed" : "pointer", transition: "all 0.15s" }}>
                        {reason}
                      </button>
                    );
                  })}
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                  <button onClick={closeAdjustDialog} disabled={adjustSubmitting}
                    style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-primary)", fontSize: 13, fontWeight: 500, cursor: adjustSubmitting ? "not-allowed" : "pointer" }}>返回</button>
                  <button onClick={handleAdjustSubmit} disabled={adjustSubmitting || !adjustReason || !adjustAmount}
                    style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: (adjustSubmitting || !adjustReason || !adjustAmount) ? "var(--border)" : (isPlus ? "#4ade80" : "#dc2626"), color: (adjustSubmitting || !adjustReason || !adjustAmount) ? "var(--text-muted)" : (isPlus ? "#0f0f0f" : "#fff"), fontSize: 13, fontWeight: 600, cursor: (adjustSubmitting || !adjustReason || !adjustAmount) ? "not-allowed" : "pointer", transition: "all 0.15s" }}>
                    {adjustSubmitting ? "处理中..." : (isPlus ? "确认增加" : "确认扣减")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Header */}
      <header className="ck-app-header" style={{ padding: "0 24px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)", background: "var(--bg)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600, fontFamily: "var(--font-space)" }}>管理后台</span>
          {totalPending > 0 && (
            <span className="ck-pill" style={{ fontSize: 11, padding: "2px 7px", borderRadius: "var(--ck-radius-round)", background: "#fb923c22", border: "1px solid rgba(251,146,60,0.4)", color: "#fb923c", fontFamily: "var(--font-space)" }}>
              {totalPending} 待处理
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-space)" }}>
            {refreshing ? "刷新中…" : <><RelativeTime from={lastRefreshAt} />更新</>}
          </span>
          <button onClick={() => fetchData(false)} disabled={refreshing}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, minHeight: 28, padding: "0 10px", fontSize: 12, color: "var(--text-secondary)", background: "transparent", border: "1px solid var(--border)", borderRadius: 6, cursor: refreshing ? "not-allowed" : "pointer" }}>
            <i className="ri-refresh-line" style={{ fontSize: 13 }} /> 刷新
          </button>
          <a className="ck-btn" href="/" style={{ display: "inline-flex", alignItems: "center", minHeight: 32, padding: "0 12px", fontSize: 12, color: "var(--text-muted)", textDecoration: "none" }}>← 返回首页</a>
        </div>
      </header>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 24px" }}>
        {/* Tabs + Search + Export */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
          <div className="ck-segmented" style={{ display: "flex", gap: 0, padding: 0, borderRadius: 8, background: "var(--surface)", border: "none", width: "fit-content" }}>
            {(["orders", "users"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} data-active={tab === t}
                style={{ padding: "6px 16px", borderRadius: 7, border: "none", background: "transparent", color: tab === t ? "var(--accent)" : "var(--text-muted)", fontSize: 13, fontWeight: 500, cursor: "pointer", transition: "all 0.15s" }}>
                {t === "orders" ? `订单 (${totalPending} 待处理)` : `用户 (${users.length})`}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flex: "1 1 240px", minWidth: 200, maxWidth: 480 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <i className="ri-search-line" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: "var(--text-muted)" }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                style={{ width: "100%", padding: "8px 12px 8px 32px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--mosaic-control-bg)", color: "var(--text-primary)", fontSize: 13, outline: "none" }}
              />
              {search && (
                <button onClick={() => setSearch("")} aria-label="清空"
                  style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 22, height: 22, border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4 }}>
                  <i className="ri-close-line" style={{ fontSize: 14 }} />
                </button>
              )}
            </div>
            <button onClick={tab === "orders" ? exportOrders : exportUsers}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", fontSize: 12, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}>
              <i className="ri-download-line" style={{ fontSize: 14 }} /> 导出 CSV
            </button>
          </div>
        </div>

        {/* Orders Tab */}
        {tab === "orders" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Pending */}
            <section>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 10, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                待处理订单 {lowerSearch && pendingOrders.length !== orders.filter(o => o.status === "pending").length ? `（已过滤 ${pendingOrders.length}/${orders.filter(o => o.status === "pending").length}）` : ""}
              </div>
              {pendingOrders.length === 0 ? (
                <div className="ck-data-row" style={{ padding: "24px", textAlign: "center", borderRadius: 8, border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 13 }}>
                  {lowerSearch ? "无匹配的待处理订单" : "暂无待处理订单"}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {pendingOrders.map(order => {
                    const pkg = PACKAGES.find(p => p.id === order.package_id);
                    return (
                      <div key={order.id} className="ck-data-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderRadius: 8, border: "1.5px solid rgba(251,146,60,0.3)", background: "rgba(251,146,60,0.04)" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--font-space)", letterSpacing: "0.04em", color: "var(--text-primary)" }}>{order.id}</span>
                            <span className="ck-pill" style={{ fontSize: 11, padding: "2px 7px", borderRadius: "var(--ck-radius-round)", background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.3)", color: "#fb923c" }}>
                              {pkg?.name ?? order.package_id} ¥{pkg?.price_yuan} · {pkg?.credits} 张
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                            {order.email} · {new Date(order.created_at).toLocaleString("zh-CN")}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                          <button className="ck-btn" onClick={() => openCancelDialog(order)} disabled={confirming === order.id}
                            style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", fontSize: 13, fontWeight: 500, cursor: confirming === order.id ? "not-allowed" : "pointer" }}>
                            取消
                          </button>
                          <button className="ck-primary-btn" onClick={() => handleConfirm(order.id)} disabled={confirming === order.id}
                            style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: confirming === order.id ? "var(--border)" : "var(--text-primary)", color: confirming === order.id ? "var(--text-muted)" : "var(--bg)", fontSize: 13, fontWeight: 600, cursor: confirming === order.id ? "not-allowed" : "pointer", transition: "all 0.15s" }}>
                            {confirming === order.id ? "处理中..." : "确认到账"}
                          </button>
                        </div>
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
                  已处理 ({confirmedOrders.length})
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {confirmedOrders.map(order => {
                    const pkg = PACKAGES.find(p => p.id === order.package_id);
                    return (
                      <div key={order.id} className="ck-data-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderRadius: 8, border: "1px solid var(--border)", opacity: 0.7 }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <div style={{ fontSize: 13, fontFamily: "var(--font-space)", fontWeight: 600 }}>{order.id}</div>
                          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{order.email} · {pkg?.name} ¥{pkg?.price_yuan}</div>
                        </div>
                        <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: "var(--ck-radius-round)", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)", color: "#4ade80" }}>已到账</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Cancelled */}
            {cancelledOrders.length > 0 && (
              <section>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", letterSpacing: "0.05em", textTransform: "uppercase" }}>已取消</div>
                  <span className="ck-pill" style={{ fontSize: 11, padding: "2px 7px", borderRadius: "var(--ck-radius-round)", background: "rgba(220,38,38,0.12)", border: "1px solid rgba(220,38,38,0.4)", color: "#f87171", fontFamily: "var(--font-space)" }}>
                    {cancelledOrders.length}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {cancelledOrders.map(order => {
                    const pkg = PACKAGES.find(p => p.id === order.package_id);
                    const reasonText = order.confirmed_by?.replace(/\s*\(by\s+[^)]+\)\s*$/, "");
                    return (
                      <div key={order.id} className="ck-data-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderRadius: 8, border: "1.5px solid rgba(220,38,38,0.32)", background: "rgba(220,38,38,0.05)" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--font-space)", letterSpacing: "0.04em", color: "var(--text-primary)", textDecoration: "line-through", textDecorationColor: "#ef4444", textDecorationThickness: 2 }}>
                              {order.id}
                            </span>
                            <span className="ck-pill" style={{ fontSize: 11, padding: "2px 7px", borderRadius: "var(--ck-radius-round)", background: "rgba(220,38,38,0.12)", border: "1px solid rgba(220,38,38,0.4)", color: "#f87171" }}>
                              {pkg?.name ?? order.package_id} ¥{pkg?.price_yuan}
                            </span>
                            {reasonText && (
                              <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: "var(--ck-radius-round)", background: "var(--mosaic-control-bg)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                                {reasonText}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                            {order.email}{order.confirmed_at ? ` · 取消于 ${new Date(order.confirmed_at).toLocaleString("zh-CN")}` : ""}
                          </div>
                        </div>
                        <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: "var(--ck-radius-round)", background: "#dc2626", border: "1px solid #dc2626", color: "#fff", fontWeight: 600, flexShrink: 0 }}>已取消</span>
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
            {filteredUsers.length === 0 ? (
              <div className="ck-data-row" style={{ padding: "24px", textAlign: "center", borderRadius: 8, border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 13 }}>
                {lowerSearch ? "无匹配用户" : "暂无用户"}
              </div>
            ) : filteredUsers.map(u => {
              const expanded = expandedUserId === u.user_id;
              return (
                <div key={u.user_id} style={{ display: "flex", flexDirection: "column", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", overflow: "hidden" }}>
                  <div className="ck-data-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", gap: 12, flexWrap: "wrap" }}>
                    <button onClick={() => toggleExpandUser(u.user_id)}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: 0, background: "transparent", border: "none", color: "var(--text-primary)", fontSize: 13, cursor: "pointer", textAlign: "left", flex: "1 1 200px", minWidth: 0 }}>
                      <i className={expanded ? "ri-arrow-down-s-line" : "ri-arrow-right-s-line"} style={{ fontSize: 16, color: "var(--text-muted)" }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</span>
                    </button>
                    <div style={{ display: "flex", gap: 16, fontSize: 12, fontFamily: "var(--font-space)", alignItems: "center" }}>
                      <span style={{ color: u.credits_remaining <= 10 ? "#fb923c" : "var(--text-secondary)" }}>余 {u.credits_remaining} 张</span>
                      <span style={{ color: "var(--text-muted)" }}>已用 {u.total_used}</span>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => openAdjustDialog(u, 1)} title="增加积分"
                          style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid rgba(74,222,128,0.4)", background: "rgba(74,222,128,0.08)", color: "#4ade80", fontSize: 16, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>+</button>
                        <button onClick={() => openAdjustDialog(u, -1)} title="扣减积分"
                          style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid rgba(220,38,38,0.4)", background: "rgba(220,38,38,0.08)", color: "#f87171", fontSize: 16, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>−</button>
                      </div>
                    </div>
                  </div>

                  {expanded && (
                    <div style={{ padding: "12px 16px 16px", borderTop: "1px solid var(--border)", background: "var(--mosaic-control-bg)" }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                        积分流水（最近 100 条）
                      </div>
                      {loadingTx ? (
                        <div style={{ padding: "16px 0", fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>加载中…</div>
                      ) : transactions.length === 0 ? (
                        <div style={{ padding: "16px 0", fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>暂无流水</div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {transactions.map(tx => {
                            const meta = TX_TYPE_META[tx.type] ?? { label: tx.type, color: "var(--text-muted)" };
                            const positive = tx.credits_delta > 0;
                            return (
                              <div key={tx.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "8px 10px", borderRadius: 6, background: "var(--surface)", fontSize: 12 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
                                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: meta.color, flexShrink: 0 }} />
                                  <span style={{ color: meta.color, fontWeight: 600, flexShrink: 0 }}>{meta.label}</span>
                                  <span style={{ color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {tx.note ?? ""}
                                    {tx.order_id ? ` · ${tx.order_id}` : ""}
                                    {tx.granted_by ? ` · by ${tx.granted_by}` : ""}
                                  </span>
                                </div>
                                <span style={{ fontFamily: "var(--font-space)", fontWeight: 600, color: positive ? "#4ade80" : "#f87171", flexShrink: 0 }}>
                                  {positive ? "+" : ""}{tx.credits_delta}
                                </span>
                                <span style={{ color: "var(--text-muted)", fontSize: 11, flexShrink: 0 }}>
                                  {new Date(tx.created_at).toLocaleString("zh-CN")}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
