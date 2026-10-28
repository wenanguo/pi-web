import type {
  ProjectRoadmap,
  ProjectRoadmapOperation,
  ProjectRoadmapOperationResult,
} from "./project-roadmaps-shared";

/**
 * The project's plans, as a global the extensions can reach.
 *
 * A pi extension runs inside the Pi Web process, but it is loaded by the SDK's
 * own loader: it cannot import this app's modules (the `@/` alias means nothing
 * to it), and it must not import them anyway — an extension is meant to work in
 * the pi CLI too. So the app publishes what an extension needs here, the same
 * way the session liveness registry is published (lib/session-liveness.ts).
 *
 * The registry is versioned: an extension that finds a registry of another
 * version leaves it alone and says the plan is not available.
 */

export const PROJECT_ROADMAPS_REGISTRY_KEY = "pi-web/project-roadmaps/v1";

export interface ProjectPlanEntry {
  projectKey: string;
  projectName: string;
  /** The project's root directory. */
  root: string;
  roadmap: ProjectRoadmap;
}

export interface ProjectRoadmapsRegistry {
  version: 1;
  /** Every project, with its plan. */
  list: () => Promise<ProjectPlanEntry[]>;
  /** The plan of the project a directory belongs to: the one whose root holds it. */
  readFor: (cwd: string) => Promise<ProjectPlanEntry | undefined>;
  /** Writes one project's plan. */
  write: (roadmap: ProjectRoadmap) => Promise<ProjectRoadmap>;
  /**
   * Applies one change to a project's plan, to the plan as it is at that moment.
   * The model sends changes and not whole plans: pi runs the tool calls of one
   * message at the same time, and whole plans would lose each other.
   */
  apply: (
    projectKey: string,
    operation: ProjectRoadmapOperation,
  ) => Promise<ProjectRoadmapOperationResult>;
}

function isCompatibleRegistry(value: unknown): value is ProjectRoadmapsRegistry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ProjectRoadmapsRegistry>;
  return candidate.version === 1
    && typeof candidate.list === "function"
    && typeof candidate.readFor === "function"
    && typeof candidate.write === "function"
    && typeof candidate.apply === "function";
}

/** The last path segment of a project root, for "/" and "\\" paths alike. */
function projectName(root: string): string {
  const trimmed = root.replace(/[\\/]+$/, "");
  const separator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const name = separator >= 0 ? trimmed.slice(separator + 1) : trimmed;
  return name || root;
}

/** Whether a directory is a project's root, or inside it. */
function holds(root: string, cwd: string): boolean {
  const normalize = (path: string) => path.replace(/[\\/]+$/, "").toLowerCase();
  const projectRoot = normalize(root);
  const directory = normalize(cwd);
  if (projectRoot === directory) return true;
  return directory.startsWith(`${projectRoot}/`) || directory.startsWith(`${projectRoot}\\`);
}

/**
 * The projects and their plans.
 *
 * The SDK is imported here and not at the top: the app starts before it needs
 * pi, and the registry is installed with the server.
 */
async function collectProjects(): Promise<ProjectPlanEntry[]> {
  const [{ listAllSessions }, { readProjectRoadmaps }] = await Promise.all([
    import("./session-reader"),
    import("./project-roadmaps"),
  ]);
  const sessions = await listAllSessions();
  const roadmaps = readProjectRoadmaps().projects;
  const byKey = new Map<string, ProjectPlanEntry>();
  for (const session of sessions) {
    const root = session.projectRoot ?? session.cwd;
    if (!root) continue;
    const key = session.projectKey ?? root;
    const existing = byKey.get(key);
    if (existing) continue;
    byKey.set(key, {
      projectKey: key,
      projectName: projectName(root),
      root,
      roadmap: roadmaps[key] ?? { projectKey: key, milestones: [] },
    });
  }
  return [...byKey.values()];
}

function createRegistry(): ProjectRoadmapsRegistry {
  return {
    version: 1,
    list: async () => collectProjects(),
    readFor: async (cwd: string) => {
      const projects = await collectProjects();
      return projects.find((project) => holds(project.root, cwd));
    },
    write: async (roadmap: ProjectRoadmap) => {
      const { writeProjectRoadmap } = await import("./project-roadmaps");
      const file = await writeProjectRoadmap(roadmap);
      const saved = file.projects[roadmap.projectKey];
      if (!saved) throw new Error("The plan was not written");
      return saved;
    },
    apply: async (projectKey: string, operation: ProjectRoadmapOperation) => {
      const { applyProjectRoadmapOperation } = await import("./project-roadmaps");
      return applyProjectRoadmapOperation(projectKey, operation);
    },
  };
}

/** The registry, when one is installed. */
export function getProjectRoadmapsRegistry(): ProjectRoadmapsRegistry | undefined {
  const store = globalThis as Record<PropertyKey, unknown>;
  const existing = store[Symbol.for(PROJECT_ROADMAPS_REGISTRY_KEY)];
  return isCompatibleRegistry(existing) ? existing : undefined;
}

/** Publishes the registry for the extensions. Called once, when the server starts. */
export function installProjectRoadmapsRegistry(): void {
  const store = globalThis as Record<PropertyKey, unknown>;
  const key = Symbol.for(PROJECT_ROADMAPS_REGISTRY_KEY);
  if (isCompatibleRegistry(store[key])) return;
  store[key] = createRegistry();
}
