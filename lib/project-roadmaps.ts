import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { serializeByKey } from "./key-serializer";
import { readRegularFileText } from "./regular-file";
import {
  normalizeRoadmap,
  PROJECT_ROADMAP_VERSION,
  type ProjectRoadmap,
  type ProjectRoadmapFile,
} from "./project-roadmaps-shared";

/**
 * The projects' roadmaps in `pi-web-projects.json` beside pi's own files.
 *
 * They are the user's plans, so like the sidebar's pins they are never rebuilt:
 * writes are serialized in-process, locked against other processes, replaced
 * atomically, and a file that cannot be parsed is set aside, never overwritten.
 */

const MAX_BYTES = 4 * 1024 * 1024;
const QUEUE_KEY: symbol = Symbol.for("pi-web:project-roadmaps-write-queue");

const LOCK_OPTIONS = {
  realpath: false,
  stale: 10_000,
  retries: { retries: 10, factor: 2, minTimeout: 25, maxTimeout: 500 },
  onCompromised: (error: Error) => {
    console.warn(`[pi-web] the project roadmaps lock was compromised: ${error.message}`);
  },
};

/** Another process held the file's lock for longer than the retries wait. */
export class ProjectRoadmapsLockedError extends Error {
  constructor(message = "Another process holds the project roadmaps lock") {
    super(message);
    this.name = "ProjectRoadmapsLockedError";
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

export function getProjectRoadmapsPath(agentDir = getAgentDir()): string {
  return join(agentDir, "pi-web-projects.json");
}

function emptyFile(): ProjectRoadmapFile {
  return { version: PROJECT_ROADMAP_VERSION, revision: 0, projects: {} };
}

function parseFile(text: string): ProjectRoadmapFile | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const candidate = raw as Record<string, unknown>;
  const revision = typeof candidate.revision === "number" && Number.isFinite(candidate.revision)
    ? candidate.revision
    : 0;
  const projects: Record<string, ProjectRoadmap> = {};
  const source = typeof candidate.projects === "object" && candidate.projects !== null && !Array.isArray(candidate.projects)
    ? (candidate.projects as Record<string, unknown>)
    : {};
  for (const [key, value] of Object.entries(source)) {
    const roadmap = normalizeRoadmap(value);
    if (roadmap) projects[key] = roadmap;
  }
  return { version: PROJECT_ROADMAP_VERSION, revision, projects };
}

/** The roadmaps of every project that has one. Never throws; a missing or unreadable file reads as empty. */
export function readProjectRoadmaps(path = getProjectRoadmapsPath()): ProjectRoadmapFile {
  try {
    const text = readRegularFileText(path, MAX_BYTES);
    if (text === undefined) return emptyFile();
    return parseFile(text) ?? emptyFile();
  } catch (error) {
    console.warn(`[pi-web] could not read the project roadmaps: ${error instanceof Error ? error.message : String(error)}`);
    return emptyFile();
  }
}

/** One project's roadmap, or undefined when it has none. */
export function readProjectRoadmap(projectKey: string, path = getProjectRoadmapsPath()): ProjectRoadmap | undefined {
  return readProjectRoadmaps(path).projects[projectKey];
}

/**
 * Writes one project's roadmap, leaving every other project's alone.
 *
 * The whole file is replaced under the lock, so two projects written at the same
 * time cannot lose each other's roadmap: the second write reads the first one's
 * result.
 */
export function writeProjectRoadmap(
  roadmap: ProjectRoadmap,
  path = getProjectRoadmapsPath(),
): Promise<ProjectRoadmapFile> {
  return serializeByKey(QUEUE_KEY, path, async () => {
    mkdirSync(dirname(path), { recursive: true });
    let release: () => Promise<void>;
    try {
      release = await lockfile.lock(path, LOCK_OPTIONS);
    } catch (error) {
      if (errorCode(error) === "ELOCKED") throw new ProjectRoadmapsLockedError();
      throw error;
    }
    try {
      const text = readRegularFileText(path, MAX_BYTES);
      const file = text === undefined ? emptyFile() : parseFile(text) ?? emptyFile();
      const next: ProjectRoadmapFile = {
        version: PROJECT_ROADMAP_VERSION,
        revision: file.revision + 1,
        projects: { ...file.projects, [roadmap.projectKey]: roadmap },
      };
      writePrivateFileAtomicSync(path, JSON.stringify(next, null, 2) + "\n");
      return next;
    } finally {
      await release();
    }
  });
}

/** Removes one project's roadmap: the project keeps its place in the list, without a plan. */
export function deleteProjectRoadmap(
  projectKey: string,
  path = getProjectRoadmapsPath(),
): Promise<ProjectRoadmapFile> {
  return serializeByKey(QUEUE_KEY, path, async () => {
    mkdirSync(dirname(path), { recursive: true });
    let release: () => Promise<void>;
    try {
      release = await lockfile.lock(path, LOCK_OPTIONS);
    } catch (error) {
      if (errorCode(error) === "ELOCKED") throw new ProjectRoadmapsLockedError();
      throw error;
    }
    try {
      const text = readRegularFileText(path, MAX_BYTES);
      const file = text === undefined ? emptyFile() : parseFile(text) ?? emptyFile();
      if (!(projectKey in file.projects)) return file;
      const projects = { ...file.projects };
      delete projects[projectKey];
      const next: ProjectRoadmapFile = {
        version: PROJECT_ROADMAP_VERSION,
        revision: file.revision + 1,
        projects,
      };
      writePrivateFileAtomicSync(path, JSON.stringify(next, null, 2) + "\n");
      return next;
    } finally {
      await release();
    }
  });
}

/** The file's revision, for a client that polls. Null when the file cannot be read. */
export function getProjectRoadmapsRevision(path = getProjectRoadmapsPath()): number | null {
  try {
    statSync(path);
  } catch {
    return null;
  }
  return readProjectRoadmaps(path).revision;
}
