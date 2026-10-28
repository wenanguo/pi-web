import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  parseCustomAgentDefinition,
  type CustomAgentDefinition,
} from "./custom-agents-shared";

/**
 * The directory a fork's custom agents live in: `custom-agent/agents/*.md` hold the
 * personas, `custom-agent/extensions/` holds the capabilities (pi extensions).
 *
 * The directory ships with the repository, so it is found next to the app the fork
 * runs. `PI_WEB_CUSTOM_AGENT_DIR` moves it, for an install that starts the server
 * from another folder.
 */
export const CUSTOM_AGENT_DIR_ENV = "PI_WEB_CUSTOM_AGENT_DIR";

export function customAgentBaseDir(): string {
  const configured = process.env[CUSTOM_AGENT_DIR_ENV]?.trim();
  if (configured) return resolve(configured);
  return join(process.cwd(), "custom-agent");
}

/** The directory the personas are read from. */
export function customAgentAgentsDir(): string {
  return join(customAgentBaseDir(), "agents");
}

/** The directory the capability extensions are loaded from. */
export function customAgentExtensionsDir(): string {
  return join(customAgentBaseDir(), "extensions");
}

/**
 * The capability extension paths a session loads.
 *
 * The SDK treats a directory in `additionalExtensionPaths` as one extension package
 * (it wants an `index.ts` or a `package.json` manifest at its root), so the files
 * are enumerated here with the SDK's own discovery rules: `*.ts` / `*.js` directly
 * in the directory, and a subdirectory with an `index.ts` / `index.js`. Each file
 * is then loaded as an extension of its own.
 */
export function customAgentExtensionPaths(): string[] {
  const dir = customAgentExtensionsDir();
  if (!existsSync(dir)) return [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    console.error(`[pi-web] could not read the custom agent extensions in ${dir}:`, error instanceof Error ? error.message : error);
    return [];
  }
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    try {
      if (entry.isFile() && /\.(ts|js)$/.test(entry.name)) {
        paths.push(path);
        continue;
      }
      if (!entry.isDirectory()) continue;
      for (const name of ["index.ts", "index.js"]) {
        const candidate = join(path, name);
        if (existsSync(candidate)) {
          paths.push(candidate);
          break;
        }
      }
    } catch {
      // An entry that cannot be read is skipped: one broken extension does not
      // take the others with it.
    }
  }
  return paths;
}

/**
 * Every custom agent the fork defines, by file name. A file that is not a valid
 * definition is skipped with a warning: one broken persona must not hide the others.
 */
export function listCustomAgents(): CustomAgentDefinition[] {
  const dir = customAgentAgentsDir();
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir).filter((name) => name.toLowerCase().endsWith(".md")).sort();
  } catch (error) {
    console.error(`[pi-web] could not read the custom agent directory ${dir}:`, error instanceof Error ? error.message : error);
    return [];
  }

  const agents: CustomAgentDefinition[] = [];
  const seen = new Set<string>();
  for (const name of entries) {
    const filePath = join(dir, name);
    try {
      if (!statSync(filePath).isFile()) continue;
      const definition = parseCustomAgentDefinition(readFileSync(filePath, "utf-8"), {
        id: basename(name, ".md"),
        filePath,
      });
      if (!definition) {
        console.warn(`[pi-web] ignoring the custom agent ${name}: it is not a valid definition`);
        continue;
      }
      if (seen.has(definition.id)) {
        console.warn(`[pi-web] ignoring the custom agent ${name}: the id "${definition.id}" is taken`);
        continue;
      }
      seen.add(definition.id);
      agents.push(definition);
    } catch (error) {
      console.warn(`[pi-web] ignoring the custom agent ${name}:`, error instanceof Error ? error.message : error);
    }
  }
  return agents;
}

/** One custom agent by id. Undefined means the fork defines no such agent. */
export function resolveCustomAgent(id: string): CustomAgentDefinition | undefined {
  const wanted = id.trim().toLowerCase();
  if (!wanted) return undefined;
  return listCustomAgents().find((agent) => agent.id.toLowerCase() === wanted);
}
