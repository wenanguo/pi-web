/**
 * The project's roadmap: milestones and the tasks under them.
 *
 * A roadmap belongs to a project (its workspace key), and holds what the user
 * plans there. It is the app's own state, kept in `pi-web-projects.json` beside
 * pi's files (lib/project-roadmaps.ts), so a project is never written to.
 *
 * The types and the rules live here, client-safe: the browser edits a roadmap
 * with them, and the server validates what it is sent with the same rules.
 */

export const PROJECT_ROADMAP_VERSION = 1;

export type TaskStatus = "todo" | "doing" | "done" | "blocked";
export type MilestoneStatus = "planned" | "in-progress" | "done" | "blocked";
export type TaskPriority = "low" | "medium" | "high";

export const TASK_STATUSES: readonly TaskStatus[] = ["todo", "doing", "done", "blocked"];
export const MILESTONE_STATUSES: readonly MilestoneStatus[] = ["planned", "in-progress", "done", "blocked"];
export const TASK_PRIORITIES: readonly TaskPriority[] = ["low", "medium", "high"];

export interface ProjectTask {
  id: string;
  title: string;
  status: TaskStatus;
  assignee?: string;
  /** YYYY-MM-DD. */
  due?: string;
  priority?: TaskPriority;
}

export interface ProjectMilestone {
  id: string;
  title: string;
  status: MilestoneStatus;
  /** YYYY-MM-DD. */
  due?: string;
  tasks: ProjectTask[];
}

export interface ProjectRoadmap {
  /** The project's workspace key (lib/workspace-memory.ts). */
  projectKey: string;
  /** The name shown for the project; the project list owns the real one. */
  projectName?: string;
  milestones: ProjectMilestone[];
}

export interface ProjectRoadmapFile {
  version: 1;
  revision: number;
  projects: Record<string, ProjectRoadmap>;
}

const MAX_TITLE = 500;
const MAX_ITEMS = 500;

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function dateValue(value: unknown): string | undefined {
  const text = stringValue(value);
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
}

function idValue(value: unknown, fallback: string): string {
  const text = stringValue(value);
  return text ? text.slice(0, 120) : fallback;
}

function taskStatus(value: unknown): TaskStatus {
  return TASK_STATUSES.includes(value as TaskStatus) ? (value as TaskStatus) : "todo";
}

function milestoneStatus(value: unknown): MilestoneStatus {
  return MILESTONE_STATUSES.includes(value as MilestoneStatus) ? (value as MilestoneStatus) : "planned";
}

function priorityValue(value: unknown): TaskPriority | undefined {
  return TASK_PRIORITIES.includes(value as TaskPriority) ? (value as TaskPriority) : undefined;
}

/**
 * A task, or undefined when it is not one. A task without a title is not a task:
 * it would show as an empty row.
 */
export function normalizeTask(value: unknown, index: number): ProjectTask | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const title = stringValue(candidate.title);
  if (!title) return undefined;
  const task: ProjectTask = {
    id: idValue(candidate.id, `task-${index}`),
    title: title.slice(0, MAX_TITLE),
    status: taskStatus(candidate.status),
  };
  const assignee = stringValue(candidate.assignee);
  if (assignee) task.assignee = assignee.slice(0, 120);
  const due = dateValue(candidate.due);
  if (due) task.due = due;
  const priority = priorityValue(candidate.priority);
  if (priority) task.priority = priority;
  return task;
}

/** A milestone, or undefined when it is not one. */
export function normalizeMilestone(value: unknown, index: number): ProjectMilestone | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const title = stringValue(candidate.title);
  if (!title) return undefined;
  const tasks = Array.isArray(candidate.tasks)
    ? candidate.tasks
      .map((task, taskIndex) => normalizeTask(task, taskIndex))
      .filter((task): task is ProjectTask => task !== undefined)
      .slice(0, MAX_ITEMS)
    : [];
  const milestone: ProjectMilestone = {
    id: idValue(candidate.id, `milestone-${index}`),
    title: title.slice(0, MAX_TITLE),
    status: milestoneStatus(candidate.status),
    tasks,
  };
  const due = dateValue(candidate.due);
  if (due) milestone.due = due;
  return milestone;
}

/**
 * A roadmap, or undefined when it is not one. The project key is required: a
 * roadmap without one could not be filed under its project.
 */
export function normalizeRoadmap(value: unknown): ProjectRoadmap | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const projectKey = stringValue(candidate.projectKey);
  if (!projectKey) return undefined;
  const milestones = Array.isArray(candidate.milestones)
    ? candidate.milestones
      .map((milestone, index) => normalizeMilestone(milestone, index))
      .filter((milestone): milestone is ProjectMilestone => milestone !== undefined)
      .slice(0, MAX_ITEMS)
    : [];
  const roadmap: ProjectRoadmap = { projectKey, milestones };
  const projectName = stringValue(candidate.projectName);
  if (projectName) roadmap.projectName = projectName.slice(0, 200);
  return roadmap;
}

export function emptyRoadmap(projectKey: string, projectName?: string): ProjectRoadmap {
  return {
    projectKey,
    ...(projectName ? { projectName } : {}),
    milestones: [],
  };
}

export interface Progress {
  total: number;
  done: number;
  /** 0-100, rounded down. */
  percent: number;
}

export function milestoneProgress(milestone: ProjectMilestone): Progress {
  const total = milestone.tasks.length;
  const done = milestone.tasks.filter((task) => task.status === "done").length;
  return { total, done, percent: total ? Math.floor((done / total) * 100) : 0 };
}

export function roadmapProgress(roadmap: ProjectRoadmap): Progress {
  const tasks = roadmap.milestones.flatMap((milestone) => milestone.tasks);
  const total = tasks.length;
  const done = tasks.filter((task) => task.status === "done").length;
  return { total, done, percent: total ? Math.floor((done / total) * 100) : 0 };
}

/** A fresh id for a milestone or a task. */
export function newItemId(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${random}`;
}
