import type { InlineExtension } from "@earendil-works/pi-coding-agent";

export const CUSTOM_AGENT_EXTENSION_NAME = "pi-web-custom-agent";

export interface CustomAgentExtensionOptions {
  /** The persona, sent with every run of the session. */
  getPrompt: () => string | undefined;
  /** The tools the agent may call. Undefined means no narrowing. */
  getTools?: () => readonly string[] | undefined;
}

/**
 * Send a custom agent's persona with every run of its session, and keep the
 * session's tool surface the agent's own.
 *
 * The persona is appended to pi's own prompt, not put in place of it: pi's prompt
 * carries the tool rules and the skill catalog, and a custom agent is a coding
 * agent with a different job description, not a different agent runtime. The
 * handler runs on `before_agent_start`, so the persona is sent on every run and a
 * session that is reopened later keeps it (the transcript replays pi's own
 * sections, and the persona is added again on top).
 *
 * The tool list is applied on the same hook, because pi activates a tool an
 * extension registers after the session was built: without this, a capability
 * extension that comes up late would put a tool the agent does not name back into
 * the model's hands.
 *
 * `getPrompt` is read on every run, so the persona the session was started with is
 * the one every run sends.
 */
export function createCustomAgentExtension(
  options: CustomAgentExtensionOptions,
): InlineExtension {
  return {
    name: CUSTOM_AGENT_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      pi.on("before_agent_start", (event) => {
        const tools = options.getTools?.();
        if (tools) {
          const active = pi
            .getAllTools()
            .filter((tool) => tools.includes(tool.name) && tool.exposure !== "hidden")
            .map((tool) => tool.name);
          pi.setActiveTools(active);
        }
        const persona = options.getPrompt()?.trim();
        if (!persona) return undefined;
        const base = event.systemPrompt?.trim() ?? "";
        return { systemPrompt: base ? `${base}\n\n${persona}` : persona };
      });
    },
  };
}
