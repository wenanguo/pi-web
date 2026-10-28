import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionEntry } from "./types";

/**
 * The session's own custom agent, written into the session file so a session that
 * is reopened later keeps its persona: the agent is part of the session's identity,
 * not of the browser that started it.
 */
export const CUSTOM_AGENT_SELECTION_TYPE = "pi-web:custom-agent";

export interface SessionCustomAgentData {
  version: 1;
  agent: string;
}

function parseCustomAgentData(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
  const candidate = data as { version?: unknown; agent?: unknown };
  if (candidate.version !== 1) return undefined;
  if (typeof candidate.agent !== "string") return undefined;
  const id = candidate.agent.trim();
  return id ? id : undefined;
}

/**
 * The custom agent of a session, read from its newest valid entry. Undefined means
 * the session carries none: an ordinary session, or one whose entry is not readable.
 */
export function readSessionCustomAgent(entries: readonly SessionEntry[]): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type !== "custom" || entry.customType !== CUSTOM_AGENT_SELECTION_TYPE) continue;
    const id = parseCustomAgentData(entry.data);
    if (id === undefined) continue;
    return id;
  }
  return undefined;
}

export function appendSessionCustomAgent(sessionManager: SessionManager, agentId: string): void {
  sessionManager.appendCustomEntry(CUSTOM_AGENT_SELECTION_TYPE, {
    version: 1,
    agent: agentId,
  } satisfies SessionCustomAgentData);
}
