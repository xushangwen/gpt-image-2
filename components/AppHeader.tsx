"use client";

import { UserButton } from "@clerk/nextjs";
import { userButtonAppearance, userProfileAppearance } from "@/lib/clerk-appearance";
import { PROVIDER_LABELS, PROVIDER_STABILITY } from "@/lib/providers";
import Button from "@/components/ui/Button";
import CreditBadge from "@/components/CreditBadge";
import type { AIEngine, ProviderChoice } from "@/lib/types";

const GEMINI_ENABLED = process.env.NEXT_PUBLIC_ENABLE_GEMINI === "true";

interface Props {
  aiEngine: AIEngine;
  setAiEngine: (e: AIEngine) => void;
  provider: ProviderChoice;
  setProvider: (p: ProviderChoice) => void;
  dark: boolean;
  setDark: (fn: (d: boolean) => boolean) => void;
  showHistory: boolean;
  setShowHistory: (fn: (v: boolean) => boolean) => void;
  historyCount: number;
}

export default function AppHeader({
  aiEngine,
  setAiEngine,
  provider,
  setProvider,
  dark,
  setDark,
  showHistory,
  setShowHistory,
  historyCount,
}: Props) {
  return (
    <header className="ck-app-header" style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 20px",
      height: 50,
      background: "var(--bg)",
      boxShadow: "inset 0 -1px 0 var(--border)",
      flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div className="ck-logo-tile" style={{ width: 28, height: 28, borderRadius: 6, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "var(--mosaic-primary-shadow)" }}>
          <i className="ri-image-ai-line" style={{ fontSize: 16, lineHeight: 1, color: "var(--btn-text)", position: "relative", zIndex: 1 }} />
        </div>
        <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text-primary)", fontFamily: "var(--font-space)" }}>
          ImageGen
        </span>
        <span className="header-badge ck-pill" style={{ fontSize: 11, padding: "2px 7px", borderRadius: "var(--ck-radius-round)", border: "1px solid var(--border-focus)", background: "var(--surface-2)", color: "var(--text-secondary)", fontFamily: "var(--font-space)", letterSpacing: "0.01em" }}>
          GPT-Image-2
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/* AI 引擎切换 */}
        <div role="radiogroup" aria-label="AI 引擎" className={`ck-segmented ck-segmented--header header-engine-seg${!GEMINI_ENABLED ? " header-engine-single" : ""}`} style={{ display: "flex", borderRadius: 8, overflow: "visible" }}>
          {(GEMINI_ENABLED ? ["openai", "gemini"] as const : ["openai"] as const).map((eng, i) => {
            const active = aiEngine === eng;
            return (
              <button
                key={eng}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setAiEngine(eng)}
                title={eng === "openai" ? "GPT-Image-2" : "Google Gemini"}
                data-active={active}
                style={{
                  padding: "4px 10px",
                  height: 28,
                  fontSize: 11,
                  fontFamily: "var(--font-space)",
                  border: "none",
                  borderLeft: i > 0 ? "1px solid var(--border-soft)" : "none",
                  background: "transparent",
                  color: active ? "#fff" : "var(--text-muted)",
                  cursor: "pointer",
                  transition: "background 0.15s, color 0.15s",
                  fontWeight: active ? 500 : 400,
                  lineHeight: 1,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <i className={eng === "openai" ? "ri-openai-line" : "ri-google-line"} style={{ fontSize: 12, lineHeight: 1, color: active ? "#fff" : "currentColor" }} />
                <span style={{ color: active ? "#fff" : "currentColor" }}>{eng === "openai" ? "GPT" : "Gemini"}</span>
              </button>
            );
          })}
        </div>
        {/* 线路切换（仅 OpenAI 模式可见） */}
        {aiEngine === "openai" && (
          <div role="radiogroup" aria-label="生图线路" className="ck-segmented ck-segmented--header header-provider-seg" style={{ display: "flex", borderRadius: 8, overflow: "visible" }}>
            {(["tuzi", "yunwu"] as const).map((p) => {
              const active = provider === p;
              const recommended = p === "yunwu";
              return (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setProvider(p)}
                  title={`${PROVIDER_LABELS[p].name}${PROVIDER_LABELS[p].recommended ? "（推荐）" : ""} · ${PROVIDER_STABILITY[p].hint}`}
                  data-active={active}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "4px 10px",
                    height: 28,
                    fontSize: 11,
                    fontFamily: "var(--font-space)",
                    border: "none",
                    borderLeft: p === "yunwu" ? "1px solid var(--border-soft)" : "none",
                    background: "transparent",
                    color: active ? "#fff" : "var(--text-muted)",
                    cursor: "pointer",
                    transition: "background 0.15s, color 0.15s",
                    fontWeight: active ? 500 : 400,
                    lineHeight: 1,
                  }}
                >
                  {recommended && (
                    <i
                      className="ri-sparkling-2-fill"
                      aria-label="推荐"
                      style={{ fontSize: 11, lineHeight: 1, color: "#fbbf24", flexShrink: 0 }}
                    />
                  )}
                  <span style={{ color: active ? "#fff" : "currentColor" }}>{PROVIDER_LABELS[p].name}</span>
                </button>
              );
            })}
          </div>
        )}
        <CreditBadge />
        {/* 历史侧栏 toggle */}
        <Button
          variant="icon"
          onClick={() => setShowHistory(v => !v)}
          title={`${showHistory ? "收起" : "展开"}历史${historyCount > 0 ? `（${historyCount}）` : ""}`}
          style={{
            position: "relative",
            background: showHistory ? "var(--surface-2)" : undefined,
            color: showHistory ? "var(--accent)" : undefined,
          }}
        >
          <i className="ri-history-line" style={{ fontSize: 16, lineHeight: 1 }} />
          {historyCount > 0 && (
            <span style={{
              position: "absolute",
              top: 2,
              right: 2,
              minWidth: 14,
              height: 14,
              padding: "0 4px",
              borderRadius: 999,
              background: "var(--accent)",
              color: "var(--btn-text)",
              fontSize: 9,
              fontFamily: "var(--font-space)",
              fontWeight: 600,
              lineHeight: "14px",
              textAlign: "center",
              pointerEvents: "none",
            }}>
              {historyCount > 99 ? "99+" : historyCount}
            </span>
          )}
        </Button>
        <Button
          variant="icon"
          onClick={() => setDark(d => !d)}
          title={dark ? "切换亮色" : "切换暗色"}
        >
          <i className={dark ? "ri-sun-line" : "ri-moon-line"} style={{ fontSize: 16, lineHeight: 1 }} />
        </Button>
        <UserButton
          appearance={userButtonAppearance}
          userProfileProps={{ appearance: userProfileAppearance }}
        />
      </div>
    </header>
  );
}
