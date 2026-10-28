import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
import { readSessionUiState } from "@/lib/session-ui-state";
import { readProjectRoadmaps, writeProjectRoadmap, deleteProjectRoadmap } from "@/lib/project-roadmaps";
import { normalizeRoadmap } from "@/lib/project-roadmaps-shared";
import type { SessionInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects - the projects, with the roadmap of each.
 *
 * The projects are the ones the sidebar knows: every project a session was run
 * in, most recent activity first. The roadmap of a project is the user's plan
 * for it; a project without one has an empty roadmap.
 */
export async function GET() {
  try {
    const sessions = await listAllSessions();
    const projects = collectProjects(sessions);
    const roadmaps = readProjectRoadmaps().projects;
    return NextResponse.json(
      {
        projects: projects.map((project) => ({
          key: project.key,
          name: project.name,
          root: project.root,
          modified: project.modified,
          roadmap: roadmaps[project.key] ?? { projectKey: project.key, milestones: [] },
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/projects - writes one project's roadmap.
 *
 * Body: { projectKey, roadmap }. The whole roadmap of that project is replaced;
 * the other projects' roadmaps are left alone.
 */
export async function PUT(req: Request) {
  try {
    const body = await req.json() as { projectKey?: unknown; roadmap?: unknown };
    if (typeof body.projectKey !== "string" || !body.projectKey.trim()) {
      return NextResponse.json({ error: "projectKey is required" }, { status: 400 });
    }
    const projectKey = body.projectKey.trim();
    const roadmap = normalizeRoadmap(body.roadmap);
    if (!roadmap || roadmap.projectKey !== projectKey) {
      return NextResponse.json({ error: "The roadmap does not belong to that project" }, { status: 400 });
    }
    const file = await writeProjectRoadmap(roadmap);
    return NextResponse.json({ revision: file.revision, roadmap: file.projects[projectKey] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/** DELETE /api/projects?projectKey=... - forgets one project's roadmap. */
export async function DELETE(req: Request) {
  try {
    const projectKey = new URL(req.url).searchParams.get("projectKey")?.trim();
    if (!projectKey) {
      return NextResponse.json({ error: "projectKey is required" }, { status: 400 });
    }
    const file = await deleteProjectRoadmap(projectKey);
    return NextResponse.json({ revision: file.revision });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

interface ProjectSummary {
  key: string;
  name: string;
  root: string;
  modified: string;
}

/**
 * The projects the sidebar knows, as one row each: the project's sessions share
 * a workspace key, and the newest one decides the project's activity.
 */
function collectProjects(sessions: readonly SessionInfo[]): ProjectSummary[] {
  const names = readSessionUiState().projectNames ?? {};
  const byKey = new Map<string, ProjectSummary>();
  for (const session of sessions) {
    const root = session.projectRoot ?? session.cwd;
    if (!root) continue;
    const key = session.projectKey ?? root;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        key,
        name: names[key] ?? projectName(root),
        root,
        modified: session.modified,
      });
      continue;
    }
    if (session.modified > existing.modified) {
      existing.modified = session.modified;
      // A worktree's sessions share the project's key, so the root stays the
      // project's own; only the name follows the newer session.
      const name = names[key];
      if (name) existing.name = name;
    }
  }
  return [...byKey.values()].sort((a, b) => b.modified.localeCompare(a.modified));
}

/** The last path segment of a project root, for "/" and "\\" paths alike. */
function projectName(root: string): string {
  const trimmed = root.replace(/[\\/]+$/, "");
  const separator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const name = separator >= 0 ? trimmed.slice(separator + 1) : trimmed;
  return name || root;
}
