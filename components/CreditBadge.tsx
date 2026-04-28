"use client";

import { useState, useEffect, useCallback } from "react";
import PaymentModal from "./PaymentModal";

export default function CreditBadge() {
  const [credits, setCredits] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);

  const fetchCredits = useCallback(async () => {
    try {
      const res = await fetch("/api/credits");
      if (res.ok) {
        const data = await res.json();
        setCredits(data.credits_remaining);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchCredits();
  }, [fetchCredits]);

  const low = credits !== null && credits <= 10;

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        title="查看积分余额 / 购买套餐"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "4px 10px",
          height: 28,
          borderRadius: 8,
          border: `1px solid ${low ? "rgba(251,146,60,0.4)" : "var(--border)"}`,
          background: low ? "rgba(251,146,60,0.08)" : "transparent",
          color: low ? "#fb923c" : "var(--text-secondary)",
          cursor: "pointer",
          fontSize: 11,
          fontFamily: "var(--font-space)",
          fontWeight: 500,
          transition: "all 0.15s",
          lineHeight: 1,
        }}
      >
        <i
          className="ri-coins-line"
          style={{ fontSize: 13, lineHeight: 1, color: low ? "#fb923c" : "var(--text-muted)" }}
        />
        {credits === null ? "—" : `${credits} 张`}
        {low && (
          <i className="ri-arrow-right-up-line" style={{ fontSize: 11, lineHeight: 1 }} />
        )}
      </button>

      {showModal && (
        <PaymentModal
          currentCredits={credits ?? 0}
          onClose={() => setShowModal(false)}
          onOrderCreated={fetchCredits}
        />
      )}
    </>
  );
}
