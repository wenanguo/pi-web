import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { serializeByKey } from "./key-serializer";
import { readRegularFileText } from "./regular-file";
import {
  emptyRoadmap,
  milestoneStatusOf,
  normalizeRoadmap,
  PROJECT_ROADMAP_VERSION,
  taskPriorityOf,
  taskStatusOf,
  type ProjectRoadmap,
  type ProjectRoadmapFile,
  type ProjectRoadmapOperation,
  type ProjectRoadmapOperationResult,
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

/** A fresh id for a milestone or a task. */
function newItemId(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${random}`;
}

/**
 * Applies one change to a project's plan, under the lock, to the plan as it is
 * at that moment.
 *
 * This is what keeps parallel changes from losing each other: the model may send
 * three "add a task" calls in one message, pi runs them at the same time, and
 * each of them reads the plan, changes it and writes it back. A change that
 * replaced the whole plan would lose the other two.
 */
export function applyProjectRoadmapOperation(
  projectKey: string,
  operation: ProjectRoadmapOperation,
  path = getProjectRoadmapsPath(),
): Promise<ProjectRoadmapOperationResult> {
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
      const current = file.projects[projectKey] ?? emptyRoadmap(projectKey);
      const result = applyOperation(current, operation);
      if (!result.ok) return { ...result, roadmap: current };
      const next: ProjectRoadmapFile = {
        version: PROJECT_ROADMAP_VERSION,
        revision: file.revision + 1,
        projects: { ...file.projects, [projectKey]: result.roadmap },
      };
      writePrivateFileAtomicSync(path, JSON.stringify(next, null, 2) + "\n");
      return result;
    } finally {
      await release();
    }
  });
}

/** One change, applied to a plan in memory. */
function applyOperation(
  roadmap: ProjectRoadmap,
  operation: ProjectRoadmapOperation,
): ProjectRoadmapOperationResult {
  const milestones = roadmap.milestones.map((milestone) => ({
    ...milestone,
    tasks: milestone.tasks.map((task) => ({ ...task })),
  }));

  if (operation.kind === "add-milestone") {
    const title = operation.title.trim();
    if (!title) return { ok: false, message: "The milestone needs a title.", roadmap };
    const milestone = {
      id: newItemId("m"),
      title,
      status: milestoneStatusOf(operation.status),
      ...(operation.due?.trim() ? { due: operation.due.trim() } : {}),
      tasks: [],
    };
    milestones.push(milestone);
    return {
      ok: true,
      message: `Added the milestone "${title}" (id: ${milestone.id}).`,
      roadmap: { ...roadmap, milestones },
    };
  }

  if (operation.kind === "add-task") {
    const title = operation.title.trim();
    const milestoneTitle = operation.milestone.trim();
    if (!title || !milestoneTitle) {
      return { ok: false, message: "The task needs a title and a milestone.", roadmap };
    }
    let milestone = milestones.find((candidate) => candidate.title === milestoneTitle);
    if (!milestone) {
      milestone = { id: newItemId("m"), title: milestoneTitle, status: "planned", tasks: [] };
      milestones.push(milestone);
    }
    const task = {
      id: newItemId("t"),
      title,
      status: taskStatusOf(operation.status),
      ...(operation.assignee?.trim() ? { assignee: operation.assignee.trim() } : {}),
      ...(operation.due?.trim() ? { due: operation.due.trim() } : {}),
      ...(operation.priority?.trim() ? { priority: taskPriorityOf(operation.priority) } : {}),
    };
    milestone.tasks.push(task);
    return {
      ok: true,
      message: `Added the task "${title}" to "${milestoneTitle}" (id: ${task.id}).`,
      roadmap: { ...roadmap, milestones },
    };
  }

  if (operation.kind === "delete-task") {
    const id = operation.id.trim();
    let removed: string | undefined;
    for (const milestone of milestones) {
      const task = milestone.tasks.find((candidate) => candidate.id === id);
      if (!task) continue;
      removed = task.title;
      milestone.tasks = milestone.tasks.filter((candidate) => candidate.id !== id);
      break;
    }
    if (!removed) {
      return { ok: false, message: `No task has the id "${id}".`, roadmap };
    }
    return {
      ok: true,
      message: `Removed the task "${removed}".`,
      roadmap: { ...roadmap, milestones },
    };
  }

  const id = operation.id.trim();
  if (!id) return { ok: false, message: "The task needs its id.", roadmap };
  let found: { title: string; milestone: string } | undefined;
  for (const milestone of milestones) {
    for (const task of milestone.tasks) {
      if (task.id !== id) continue;
      found = { title: task.title, milestone: milestone.title };
      if (operation.status?.trim()) task.status = taskStatusOf(operation.status);
      if (operation.title?.trim()) task.title = operation.title.trim();
      if (operation.assignee !== undefined) {
        if (operation.assignee.trim()) task.assignee = operation.assignee.trim();
        else delete task.assignee;
      }
      if (operation.due !== undefined) {
        if (operation.due.trim()) task.due = operation.due.trim();
        else delete task.due;
      }
      if (operation.priority !== undefined) {
        const priority = taskPriorityOf(operation.priority);
        if (priority) task.priority = priority;
        else delete task.priority;
      }
    }
  }
  if (!found) {
    return { ok: false, message: `No task has the id "${id}". Read the plan first.`, roadmap };
  }
  return {
    ok: true,
    message: `Updated the task "${found.title}" in "${found.milestone}".`,
    roadmap: { ...roadmap, milestones },
  };
}
