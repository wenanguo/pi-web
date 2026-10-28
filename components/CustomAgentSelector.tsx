"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { CustomAgentSummary } from "@/lib/custom-agents-shared";

interface Props {
  /** The custom agent the session runs as; null means an ordinary session. */
  value: string | null;
  /** Absent when the session already runs: the role of a session is fixed. */
  onChange?: (agentId: string | null) => void;
  mobile?: boolean;
  /** The controls menu is open on a phone: the label shows. */
  showLabel?: boolean;
}

/**
 * The role picker of the composer: the custom agent a fresh session starts as.
 *
 * The list comes from the server (`GET /api/custom-agents`), so a fork's agents
 * need no client change to show up here. A session that already runs keeps its
 * agent: the persona belongs to the session, not to the composer, so the picker
 * shows the agent's name without opening.
 */
export function CustomAgentSelector({ value, onChange, mobile, showLabel }: Props) {
  const { t } = useI18n();
  const [agents, setAgents] = useState<CustomAgentSummary[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/custom-agents")
      .then((response) => (response.ok ? response.json() : { agents: [] }))
      .then((data: { agents?: CustomAgentSummary[] }) => {
        if (!cancelled) setAgents(Array.isArray(data.agents) ? data.agents : []);
      })
      .catch(() => {
        if (!cancelled) setAgents([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const selected = agents.find((agent) => agent.id === value) ?? null;
  const label = selected?.displayName ?? t("chat.customAgent");

  if (!onChange) {
    // The session already runs: the agent is part of it, not a choice.
    if (!selected) return null;
    return (
      <div
        style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: mobile ? "0 6px" : "8px 12px",
          height: 32,
          color: "var(--text-muted)", fontSize: 12,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}
        title={selected.description || selected.displayName}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <path d="M12 2l2.4 6.2L21 10l-5.2 3.9L17 21l-5-3.4L7 21l1.2-7.1L3 10l6.6-1.8L12 2z" />
        </svg>
        {(!mobile || showLabel) && <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>}
      </div>
    );
  }

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        title={t("chat.changeCustomAgent") + (selected ? `: ${label}` : "")}
        aria-label={t("chat.changeCustomAgent")}
        aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
          padding: mobile ? "0 6px" : "8px 12px",
          width: mobile ? "auto" : undefined,
          height: 32,
          background: open ? "var(--bg-hover)" : "none",
          border: "none",
          borderRadius: 9,
          color: selected ? "var(--accent)" : "var(--text-muted)",
          cursor: "pointer",
          fontSize: 12,
          transition: "background 0.12s, color 0.12s",
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = "var(--bg-hover)";
        }}
        onMouseLeave={(event) => {
          if (!open) event.currentTarget.style.background = "none";
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <path d="M12 2l2.4 6.2L21 10l-5.2 3.9L17 21l-5-3.4L7 21l1.2-7.1L3 10l6.6-1.8L12 2z" />
        </svg>
        {(!mobile || showLabel) && <span style={{ whiteSpace: "nowrap" }}>{label}</span>}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            right: mobile ? undefined : 0,
            left: mobile ? 0 : undefined,
            zIndex: 100,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
            overflow: "hidden",
            minWidth: 200,
            maxWidth: 320,
          }}
        >
          <button
            onClick={() => {
              setOpen(false);
              if (value) onChange(null);
            }}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              width: "100%", padding: "7px 12px",
              background: value ? "none" : "var(--bg-selected)",
              border: "none",
              color: value ? "var(--text-muted)" : "var(--text)",
              cursor: "pointer", fontSize: 12, textAlign: "left",
            }}
            onMouseEnter={(event) => {
              if (value) event.currentTarget.style.background = "var(--bg-hover)";
            }}
            onMouseLeave={(event) => {
              if (value) event.currentTarget.style.background = "none";
            }}
          >
            {value
              ? <span style={{ width: 10, flexShrink: 0 }} />
              : <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>}
            <span style={{ flex: 1 }}>{t("chat.noCustomAgent")}</span>
          </button>
          {agents.map((agent) => {
            const isActive = agent.id === value;
            return (
              <button
                key={agent.id}
                onClick={() => {
                  setOpen(false);
                  if (!isActive) onChange(agent.id);
                }}
                title={agent.description || agent.displayName}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  width: "100%", padding: "7px 12px",
                  background: isActive ? "var(--bg-selected)" : "none",
                  border: "none",
                  color: isActive ? "var(--text)" : "var(--text-muted)",
                  cursor: "pointer", fontSize: 12, textAlign: "left",
                }}
                onMouseEnter={(event) => {
                  if (!isActive) event.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(event) => {
                  if (!isActive) event.currentTarget.style.background = "none";
                }}
              >
                {isActive
                  ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
                  : <span style={{ width: 10, flexShrink: 0 }} />}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {agent.displayName}
                  </span>
                  {agent.description && (
                    <span style={{ display: "block", fontSize: 11, color: "var(--text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {agent.description}
                    </span>
                  )}
                </span>
                {agent.tools && (
                  <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 8, flexShrink: 0 }}>
                    {t("chat.customAgentTools", { count: agent.tools.length })}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
