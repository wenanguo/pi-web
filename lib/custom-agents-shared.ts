import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { parseFrontmatter } from "./frontmatter";

/**
 * A custom agent: a persona (the prompt) plus the capabilities it may use.
 *
 * The persona lives in a Markdown file with frontmatter (lib/custom-agents.ts reads
 * the directory); the capabilities live in pi extensions the fork ships
 * (`custom-agent/extensions/`). The definition only names what the model may call,
 * so an agent's tool surface is its own, and the extensions that register those
 * tools stay ordinary pi extensions.
 */
export interface CustomAgentDefinition {
  /** The file's frontmatter `name`, or its basename. Stable across renames of the display name. */
  id: string;
  displayName: string;
  description: string;
  /** The model the agent starts on: `provider/modelId`, or a bare id when the provider is not known here. */
  model?: { provider: string; modelId: string };
  /** The model reference as written, for the UI. */
  modelRef?: string;
  thinkingLevel?: ThinkingLevel;
  /** The tools the agent may call. Undefined means no narrowing: the session keeps pi's own loadout. */
  tools?: string[];
  /** The persona, sent to the model with every run of the session. */
  prompt: string;
  /** Where the definition was read from. */
  filePath?: string;
}

/** What the browser needs of a custom agent; the prompt stays on the server. */
export interface CustomAgentSummary {
  id: string;
  displayName: string;
  description: string;
  modelRef?: string;
  thinkingLevel?: string;
  tools?: string[];
}

const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * A tool list, written as a YAML list (`[read, bash]`) or as a comma-separated
 * string (`read, bash`). An empty list means no tools at all; a missing key means
 * no narrowing.
 */
export function parseCustomAgentTools(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
  }
  if (typeof value === "string") {
    return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
  }
  return undefined;
}

/**
 * A model reference as pi's `--model` reads it: `provider/modelId`, or a bare id.
 * A provider that holds a slash cannot be told from a model id that does, so the
 * first slash decides: `provider/model`.
 */
export function parseCustomAgentModel(value: unknown): { model: { provider: string; modelId: string }; modelRef: string } | undefined {
  const reference = stringValue(value);
  if (!reference) return undefined;
  const slash = reference.indexOf("/");
  if (slash <= 0) return { model: { provider: "", modelId: reference }, modelRef: reference };
  return {
    model: { provider: reference.slice(0, slash), modelId: reference.slice(slash + 1) },
    modelRef: reference,
  };
}

/**
 * Read one custom agent definition. Undefined means the file is not a definition:
 * a broken frontmatter, an id that is not a plain name, or a file that names no
 * persona at all.
 */
export function parseCustomAgentDefinition(
  markdown: string,
  options: { id: string; filePath?: string },
): CustomAgentDefinition | undefined {
  const { data, rest } = parseFrontmatter(markdown);
  const id = stringValue(data?.name) ?? options.id;
  if (!ID_PATTERN.test(id)) return undefined;

  const bodyPrompt = rest.trim();
  const frontmatterPrompt = stringValue(data?.system_prompt) ?? stringValue(data?.systemPrompt);
  const prompt = frontmatterPrompt ?? bodyPrompt;
  if (!prompt) return undefined;

  const model = parseCustomAgentModel(data?.model);
  const thinking = stringValue(data?.thinking);
  const tools = parseCustomAgentTools(data?.tools);

  return {
    id,
    displayName: stringValue(data?.display_name) ?? stringValue(data?.displayName) ?? id,
    description: stringValue(data?.description) ?? "",
    ...(model ? { model: model.model, modelRef: model.modelRef } : {}),
    ...(thinking && THINKING_LEVELS.has(thinking as ThinkingLevel)
      ? { thinkingLevel: thinking as ThinkingLevel }
      : {}),
    ...(tools ? { tools } : {}),
    prompt,
    ...(options.filePath ? { filePath: options.filePath } : {}),
  };
}

/** What the browser receives: the prompt stays on the server. */
export function toCustomAgentSummary(agent: CustomAgentDefinition): CustomAgentSummary {
  return {
    id: agent.id,
    displayName: agent.displayName,
    description: agent.description,
    ...(agent.modelRef ? { modelRef: agent.modelRef } : {}),
    ...(agent.thinkingLevel ? { thinkingLevel: agent.thinkingLevel } : {}),
    ...(agent.tools ? { tools: agent.tools } : {}),
  };
}
