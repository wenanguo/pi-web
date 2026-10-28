import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * The project's plan, as tools the agent can call.
 *
 * This is the other half of the projects panel: the panel is where a person
 * plans, these tools are where the model works on that plan. A task the model
 * breaks down becomes a task in the panel; a task it finishes becomes a task
 * that is done.
 *
 * The extension cannot import the app (it also runs in the pi CLI, where there
 * is no app), so it reaches the plans through the registry the app publishes:
 *
 *     globalThis[Symbol.for("pi-web/project-roadmaps/v1")]
 *
 * Without that registry the tools say so, and the agent carries on without them.
 */

const REGISTRY_KEY = Symbol.for("pi-web/project-roadmaps/v1");

interface ProjectPlanEntry {
  projectKey: string;
  projectName: string;
  root: string;
  roadmap: {
    projectKey: string;
    projectName?: string;
    milestones: {
      id: string;
      title: string;
      status: string;
      due?: string;
      tasks: {
        id: string;
        title: string;
        status: string;
        assignee?: string;
        due?: string;
        priority?: string;
      }[];
    }[];
  };
}

interface ProjectRoadmapsRegistry {
  version: 1;
  list: () => Promise<ProjectPlanEntry[]>;
  readFor: (cwd: string) => Promise<ProjectPlanEntry | undefined>;
  write: (roadmap: ProjectPlanEntry["roadmap"]) => Promise<ProjectPlanEntry["roadmap"]>;
  /** Applies one change to the plan as it is at that moment. */
  apply: (
    projectKey: string,
    operation: Record<string, unknown>,
  ) => Promise<{ ok: boolean; message: string }>;
}

function registry(): ProjectRoadmapsRegistry | undefined {
  const value = (globalThis as Record<PropertyKey, unknown>)[REGISTRY_KEY];
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<ProjectRoadmapsRegistry>;
  if (candidate.version !== 1) return undefined;
  if (typeof candidate.list !== "function" || typeof candidate.readFor !== "function" || typeof candidate.write !== "function") {
    return undefined;
  }
  if (typeof candidate.apply !== "function") return undefined;
  return candidate as ProjectRoadmapsRegistry;
}

/** The plan of the project the session is in. */
async function currentProject(ctx?: ExtensionContext): Promise<ProjectPlanEntry | undefined> {
  const store = registry();
  if (!store) return undefined;
  return store.readFor(ctx?.cwd ?? process.cwd());
}

function noRegistryText(): string {
  return "The project plan is only available inside Pi Web. In the pi CLI there is no plan to read or write.";
}

/** The plan as text: what the model reads, and what it writes back against. */
function renderPlan(entry: ProjectPlanEntry): string {
  const lines: string[] = [];
  lines.push(`Project: ${entry.projectName} (${entry.root})`);
  lines.push(`Project key: ${entry.projectKey}`);
  if (entry.roadmap.milestones.length === 0) {
    lines.push("");
    lines.push("This project has no milestones yet.");
    return lines.join("\n");
  }
  for (const milestone of entry.roadmap.milestones) {
    lines.push("");
    lines.push(`## ${milestone.title} [${milestone.status}] (id: ${milestone.id})`);
    if (milestone.due) lines.push(`Due: ${milestone.due}`);
    if (milestone.tasks.length === 0) {
      lines.push("- (no tasks)");
      continue;
    }
    for (const task of milestone.tasks) {
      const facts = [task.status];
      if (task.assignee) facts.push(`owner ${task.assignee}`);
      if (task.due) facts.push(`due ${task.due}`);
      if (task.priority) facts.push(`priority ${task.priority}`);
      lines.push(`- [${facts.join(", ")}] ${task.title} (id: ${task.id})`);
    }
  }
  return lines.join("\n");
}

export default function projectPlanExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "project_plan_read",
    label: "Project plan",
    description:
      "Read the plan of the project this session is in: its milestones, their tasks, and where each task stands. Use it before planning or changing anything.",
    parameters: Type.Object({}),
    execute: async (_toolCallId, _args, _signal, _onUpdate, ctx?: ExtensionContext) => {
      const entry = await currentProject(ctx);
      if (!entry) {
        return { content: [{ type: "text" as const, text: noRegistryText() }], details: undefined, isError: true };
      }
      return {
        content: [{ type: "text" as const, text: renderPlan(entry) }],
        details: { projectKey: entry.projectKey },
      };
    },
  });

  pi.registerTool({
    name: "project_plan_add_milestone",
    label: "Add milestone",
    description:
      "Add a milestone to the plan of the project this session is in. A milestone holds the tasks of one step of the project.",
    parameters: Type.Object({
      title: Type.String({ description: "What the milestone is." }),
      status: Type.Optional(Type.String({ description: "planned, in-progress, done or blocked. Defaults to planned." })),
      due: Type.Optional(Type.String({ description: "The day it is due, YYYY-MM-DD." })),
    }),
    execute: async (_toolCallId, args: { title?: string; status?: string; due?: string }, _signal, _onUpdate, ctx?: ExtensionContext) => {
      const entry = await currentProject(ctx);
      if (!entry) {
        return { content: [{ type: "text" as const, text: noRegistryText() }], details: undefined, isError: true };
      }
      const title = (args.title ?? "").trim();
      if (!title) {
        return { content: [{ type: "text" as const, text: "The milestone needs a title." }], details: undefined, isError: true };
      }
      const result = await registry()!.apply(entry.projectKey, {
        kind: "add-milestone",
        title,
        ...(args.status ? { status: args.status.trim() } : {}),
        ...(args.due ? { due: args.due.trim() } : {}),
      });
      return {
        content: [{ type: "text" as const, text: result.message }],
        details: { projectKey: entry.projectKey },
        ...(result.ok ? {} : { isError: true }),
      };
    },
  });

  pi.registerTool({
    name: "project_plan_add_task",
    label: "Add task",
    description:
      "Add a task to a milestone of the plan of the project this session is in. The milestone is found by its title; a milestone that does not exist yet is created.",
    parameters: Type.Object({
      title: Type.String({ description: "What the task is." }),
      milestone: Type.String({ description: "The milestone the task belongs to." }),
      status: Type.Optional(Type.String({ description: "todo, doing, done or blocked. Defaults to todo." })),
      assignee: Type.Optional(Type.String({ description: "Who is on it." })),
      due: Type.Optional(Type.String({ description: "The day it is due, YYYY-MM-DD." })),
      priority: Type.Optional(Type.String({ description: "low, medium or high." })),
    }),
    execute: async (
      _toolCallId,
      args: { title?: string; milestone?: string; status?: string; assignee?: string; due?: string; priority?: string },
      _signal,
      _onUpdate,
      ctx?: ExtensionContext,
    ) => {
      const entry = await currentProject(ctx);
      if (!entry) {
        return { content: [{ type: "text" as const, text: noRegistryText() }], details: undefined, isError: true };
      }
      const title = (args.title ?? "").trim();
      const milestoneTitle = (args.milestone ?? "").trim();
      if (!title || !milestoneTitle) {
        return {
          content: [{ type: "text" as const, text: "The task needs a title and a milestone." }],
          details: undefined,
          isError: true,
        };
      }
      const result = await registry()!.apply(entry.projectKey, {
        kind: "add-task",
        milestone: milestoneTitle,
        title,
        ...(args.status ? { status: args.status.trim() } : {}),
        ...(args.assignee ? { assignee: args.assignee.trim() } : {}),
        ...(args.due ? { due: args.due.trim() } : {}),
        ...(args.priority ? { priority: args.priority.trim() } : {}),
      });
      return {
        content: [{ type: "text" as const, text: result.message }],
        details: { projectKey: entry.projectKey },
        ...(result.ok ? {} : { isError: true }),
      };
    },
  });

  pi.registerTool({
    name: "project_plan_update_task",
    label: "Update task",
    description:
      "Change a task in the plan of the project this session is in: its state, title, owner, due date or priority. The task is found by its id.",
    parameters: Type.Object({
      id: Type.String({ description: "The task's id." }),
      status: Type.Optional(Type.String({ description: "todo, doing, done or blocked." })),
      title: Type.Optional(Type.String({ description: "A new title for the task." })),
      assignee: Type.Optional(Type.String({ description: "Who is on it." })),
      due: Type.Optional(Type.String({ description: "The day it is due, YYYY-MM-DD." })),
      priority: Type.Optional(Type.String({ description: "low, medium or high." })),
    }),
    execute: async (
      _toolCallId,
      args: { id?: string; status?: string; title?: string; assignee?: string; due?: string; priority?: string },
      _signal,
      _onUpdate,
      ctx?: ExtensionContext,
    ) => {
      const entry = await currentProject(ctx);
      if (!entry) {
        return { content: [{ type: "text" as const, text: noRegistryText() }], details: undefined, isError: true };
      }
      const id = (args.id ?? "").trim();
      if (!id) {
        return { content: [{ type: "text" as const, text: "The task needs its id." }], details: undefined, isError: true };
      }
      const result = await registry()!.apply(entry.projectKey, {
        kind: "update-task",
        id,
        ...(args.status !== undefined ? { status: args.status.trim() } : {}),
        ...(args.title !== undefined ? { title: args.title.trim() } : {}),
        ...(args.assignee !== undefined ? { assignee: args.assignee.trim() } : {}),
        ...(args.due !== undefined ? { due: args.due.trim() } : {}),
        ...(args.priority !== undefined ? { priority: args.priority.trim() } : {}),
      });
      return {
        content: [{ type: "text" as const, text: result.message }],
        details: { projectKey: entry.projectKey },
        ...(result.ok ? {} : { isError: true }),
      };
    },
  });
}
