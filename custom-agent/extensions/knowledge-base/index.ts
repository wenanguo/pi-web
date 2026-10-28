import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * A knowledge base the custom agents can look things up in.
 *
 * This is the shape a fork's capability extensions take: a plain pi extension that
 * registers a tool, living next to the personas in `custom-agent/`. The fork loads
 * it for a session that runs a custom agent, and the agent's tool list decides
 * whether the model may call it.
 */

const MAX_MATCHES = 5;
const MAX_CHARS = 4000;

function knowledgeDir(): string {
  const configured = process.env.PI_WEB_CUSTOM_AGENT_DIR?.trim();
  return join(configured || join(process.cwd(), "custom-agent"), "knowledge");
}

interface KnowledgeFile {
  path: string;
  title: string;
  content: string;
}

function readKnowledge(): KnowledgeFile[] {
  const dir = knowledgeDir();
  let entries: string[];
  try {
    entries = readdirSync(dir).filter((name) => name.toLowerCase().endsWith(".md")).sort();
  } catch {
    return [];
  }
  const files: KnowledgeFile[] = [];
  for (const name of entries) {
    const path = join(dir, name);
    try {
      if (!statSync(path).isFile()) continue;
      files.push({ path, title: name.replace(/\.md$/i, ""), content: readFileSync(path, "utf-8") });
    } catch {
      // A file that cannot be read is not a reason to fail the lookup.
    }
  }
  return files;
}

/** The lines around a match, so the model sees the sentence it hit, not the whole file. */
function excerpt(content: string, index: number, radius = 2): string {
  const lines = content.split(/\r?\n/);
  const start = Math.max(0, index - radius);
  const end = Math.min(lines.length, index + radius + 1);
  return lines.slice(start, end).join("\n");
}

export default function knowledgeBaseExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "knowledge_search",
    label: "Knowledge search",
    description:
      "Search the project's knowledge base (Markdown notes under custom-agent/knowledge) and return the matching excerpts with their file names.",
    parameters: Type.Object({
      query: Type.String({ description: "What to look for." }),
    }),
    execute: async (_toolCallId, args: { query?: string }) => {
      const query = (args.query ?? "").trim();
      if (!query) {
        return {
          content: [{ type: "text" as const, text: "The query is empty." }],
          details: undefined,
          isError: true,
        };
      }
      const needles = query.toLowerCase().split(/\s+/).filter((word) => word.length > 1);
      const hits: { path: string; title: string; line: string; text: string }[] = [];
      for (const file of readKnowledge()) {
        const lines = file.content.split(/\r?\n/);
        for (let index = 0; index < lines.length && hits.length < MAX_MATCHES; index += 1) {
          const line = lines[index].toLowerCase();
          if (!needles.some((needle) => line.includes(needle))) continue;
          hits.push({ path: file.path, title: file.title, line: String(index + 1), text: excerpt(file.content, index) });
        }
      }
      const text = hits.length
        ? hits
            .map((hit) => `## ${hit.title} (${hit.path}:${hit.line})\n${hit.text}`)
            .join("\n\n")
            .slice(0, MAX_CHARS)
        : `Nothing in the knowledge base matches "${query}".`;
      return {
        content: [{ type: "text" as const, text }],
        details: { query, hits: hits.length },
      };
    },
  });
}
