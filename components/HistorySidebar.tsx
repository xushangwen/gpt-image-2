"use client";

import { formatTime } from "@/lib/format";
import type { HistoryEntry } from "@/lib/types";

interface Props {
  history: HistoryEntry[];
  open: boolean;
  onClose: () => void;
  onRestore: (entry: HistoryEntry) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}

/**
 * 历史侧栏（layout 内常驻的右侧第三栏，可折叠）
 * - open=false 时 width: 0 + overflow:hidden 平滑收起
 * - open=true 时 width: 320，主预览区 flex:1 自动让位
 * - 内层固定 width: 320 防止内容跟着 width 动画压扁
 */
export default function HistorySidebar({
  history,
  open,
  onClose,
  onRestore,
  onDelete,
  onClear,
}: Props) {
  return (
    <aside
      aria-hidden={!open}
      style={{
        width: open ? 320 : 0,
        flexShrink: 0,
        background: "var(--surface)",
        borderLeft: open ? "1px solid var(--border)" : "none",
        overflow: "hidden",
        transition: "width 0.22s ease",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      <div
        style={{
          width: 320,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <i
              className="ri-history-line"
              style={{ fontSize: 16, lineHeight: 1, color: "var(--text-secondary)" }}
            />
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
              生成历史
            </span>
            {history.length > 0 && (
              <span
                style={{
                  fontSize: 10,
                  padding: "1px 6px",
                  borderRadius: 999,
                  background: "var(--surface-2)",
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-space)",
                }}
              >
                {history.length}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="收起"
            title="收起（点击顶部历史按钮重新展开）"
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <i className="ri-arrow-right-line" style={{ fontSize: 14, lineHeight: 1 }} />
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
          {history.length === 0 ? (
            <div
              style={{
                padding: "60px 0",
                textAlign: "center",
                color: "var(--text-muted)",
                fontSize: 13,
              }}
            >
              <i
                className="ri-archive-line"
                style={{ fontSize: 28, lineHeight: 1, opacity: 0.4, display: "block", marginBottom: 10 }}
              />
              暂无历史记录
              <br />
              <span style={{ fontSize: 11, opacity: 0.7 }}>生成的图片会自动保存到这里</span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="history-item ck-data-row"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--surface-2)",
                    cursor: "pointer",
                    transition: "border-color 0.15s",
                  }}
                  onClick={() => onRestore(entry)}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.borderColor = "var(--border-focus)")
                  }
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                >
                  {entry.thumbnail && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={entry.thumbnail}
                      alt=""
                      style={{
                        width: 38,
                        height: 38,
                        objectFit: "cover",
                        borderRadius: 6,
                        flexShrink: 0,
                        border: "1px solid var(--border)",
                      }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p
                      style={{
                        fontSize: 12,
                        color: "var(--text-primary)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        marginBottom: 2,
                      }}
                    >
                      {entry.prompt}
                    </p>
                    <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {entry.versionLabel ? `${entry.versionLabel} · ` : ""}
                      {formatTime(entry.timestamp)} · {entry.imageCount} 张
                      {entry.referenceName ? " · 参考" : ""}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(entry.id);
                    }}
                    aria-label="删除"
                    title="删除该条历史"
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--text-muted)",
                      padding: 3,
                      flexShrink: 0,
                      borderRadius: 4,
                    }}
                  >
                    <i className="ri-close-line" style={{ fontSize: 15, lineHeight: 1 }} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {history.length > 0 && (
          <div
            style={{
              padding: "10px 12px",
              borderTop: "1px solid var(--border)",
              flexShrink: 0,
            }}
          >
            <button
              onClick={onClear}
              style={{
                width: "100%",
                padding: "8px 0",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text-muted)",
                fontSize: 12,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <i className="ri-delete-bin-6-line" style={{ fontSize: 14, lineHeight: 1 }} />
              清空所有历史
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
