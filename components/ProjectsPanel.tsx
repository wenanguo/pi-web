"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  emptyRoadmap,
  milestoneProgress,
  newItemId,
  roadmapProgress,
  type MilestoneStatus,
  type ProjectMilestone,
  type ProjectRoadmap,
  type ProjectTask,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/project-roadmaps-shared";

interface ProjectSummary {
  key: string;
  name: string;
  root: string;
  modified: string;
}

interface Props {
  /** The cwd the shell has open; the project it belongs to is shown first. */
  initialCwd?: string | null;
}

type SaveState = "idle" | "saving" | "saved" | "error";

const SAVE_DEBOUNCE_MS = 600;

/**
 * The project the shell has open: its root matches the cwd, Windows paths
 * compared without case. A cwd under a project (a subdirectory) matches the
 * project that holds it.
 */
function pickInitialProject(projects: ProjectSummary[], cwd: string | null | undefined): string | undefined {
  if (!cwd) return undefined;
  const wanted = cwd.replace(/[\\/]+$/, "").toLowerCase();
  const exact = projects.find((project) => project.root.replace(/[\\/]+$/, "").toLowerCase() === wanted);
  if (exact) return exact.key;
  const parent = projects.find((project) => {
    const root = project.root.replace(/[\\/]+$/, "").toLowerCase();
    return wanted.startsWith(`${root}/`) || wanted.startsWith(`${root}\\`);
  });
  return parent?.key;
}

/**
 * The projects panel: every project, its milestones and the tasks under them.
 *
 * The projects are the ones the sidebar knows. A project's roadmap is edited
 * here and kept by the server (`pi-web-projects.json`), so it survives a reload
 * and is the same for every window.
 */
export function ProjectsPanel({ initialCwd }: Props) {
  const { t } = useI18n();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [roadmaps, setRoadmaps] = useState<Record<string, ProjectRoadmap>>({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { projects?: (ProjectSummary & { roadmap?: ProjectRoadmap })[] };
      const list = data.projects ?? [];
      setProjects(list.map(({ key, name, root, modified }) => ({ key, name, root, modified })));
      setRoadmaps(Object.fromEntries(list.map((project) => [
        project.key,
        project.roadmap ?? emptyRoadmap(project.key, project.name),
      ])));
      setActiveKey((current) => current ?? pickInitialProject(list, initialCwd) ?? list[0]?.key ?? null);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [initialCwd]);

  useEffect(() => {
    void load();
  }, [load]);

  // A pending save is flushed when the panel goes away, so an edit made a
  // moment before closing is not lost.
  useEffect(() => () => {
    for (const timer of saveTimers.current.values()) clearTimeout(timer);
    saveTimers.current.clear();
  }, []);

  const save = useCallback(async (projectKey: string, roadmap: ProjectRoadmap) => {
    setSaveState("saving");
    try {
      const response = await fetch("/api/projects", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectKey, roadmap }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${response.status}`);
      }
      setSaveState("saved");
      setError(null);
    } catch (caught) {
      setSaveState("error");
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  /** An edit lands in the state at once and is written shortly after. */
  const edit = useCallback((projectKey: string, change: (roadmap: ProjectRoadmap) => ProjectRoadmap) => {
    setRoadmaps((current) => {
      const existing = current[projectKey] ?? emptyRoadmap(projectKey);
      const next = change(existing);
      const timer = saveTimers.current.get(projectKey);
      if (timer) clearTimeout(timer);
      saveTimers.current.set(projectKey, setTimeout(() => {
        saveTimers.current.delete(projectKey);
        void save(projectKey, next);
      }, SAVE_DEBOUNCE_MS));
      return { ...current, [projectKey]: next };
    });
  }, [save]);

  const activeProject = projects.find((project) => project.key === activeKey) ?? null;
  const activeRoadmap = activeKey ? roadmaps[activeKey] ?? emptyRoadmap(activeKey) : null;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <ProjectList
          projects={projects}
          roadmaps={roadmaps}
          activeKey={activeKey}
          onSelect={setActiveKey}
        />
        {projects.length === 0 && (
          <EmptyState text={t("projects.noProjects")} />
        )}
        {activeProject && activeRoadmap && (
          <ProjectDetail
            project={activeProject}
            roadmap={activeRoadmap}
            collapsed={collapsed}
            onToggle={(id) => setCollapsed((current) => ({ ...current, [id]: !current[id] }))}
            onEdit={(change) => edit(activeProject.key, change)}
          />
        )}
      </div>
      <SaveFooter state={saveState} error={error} />
    </div>
  );
}

function ProjectList({
  projects,
  roadmaps,
  activeKey,
  onSelect,
}: {
  projects: ProjectSummary[];
  roadmaps: Record<string, ProjectRoadmap>;
  activeKey: string | null;
  onSelect: (key: string) => void;
}) {
  const { t } = useI18n();
  if (projects.length === 0) return null;
  return (
    <div
      style={{
        display: "flex", gap: 6, padding: "10px 12px", overflowX: "auto",
        borderBottom: "1px solid var(--border)", background: "var(--bg-panel)",
      }}
    >
      {projects.map((project) => {
        const progress = roadmapProgress(roadmaps[project.key] ?? emptyRoadmap(project.key));
        const isActive = project.key === activeKey;
        return (
          <button
            key={project.key}
            onClick={() => onSelect(project.key)}
            title={project.root}
            style={{
              display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3,
              flexShrink: 0, minWidth: 132, maxWidth: 220, padding: "6px 10px",
              background: isActive ? "var(--bg-selected)" : "var(--bg-hover)",
              border: `1px solid ${isActive ? "var(--accent)" : "var(--border)"}`,
              borderRadius: 7, cursor: "pointer", textAlign: "left",
            }}
          >
            <span style={{
              fontSize: 12, color: isActive ? "var(--text)" : "var(--text-muted)",
              fontWeight: isActive ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              maxWidth: "100%",
            }}>
              {project.name}
            </span>
            <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
              {progress.total ? `${progress.done}/${progress.total}` : t("projects.noMilestones")}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ProjectDetail({
  project,
  roadmap,
  collapsed,
  onToggle,
  onEdit,
}: {
  project: ProjectSummary;
  roadmap: ProjectRoadmap;
  collapsed: Record<string, boolean>;
  onToggle: (id: string) => void;
  onEdit: (change: (roadmap: ProjectRoadmap) => ProjectRoadmap) => void;
}) {
  const { t } = useI18n();
  const progress = roadmapProgress(roadmap);

  const addMilestone = () => {
    const milestone: ProjectMilestone = {
      id: newItemId("m"),
      title: t("projects.newMilestone"),
      status: "planned",
      tasks: [],
    };
    onEdit((current) => ({ ...current, milestones: [...current.milestones, milestone] }));
  };

  const changeMilestone = (id: string, change: (milestone: ProjectMilestone) => ProjectMilestone) => {
    onEdit((current) => ({
      ...current,
      milestones: current.milestones.map((milestone) => milestone.id === id ? change(milestone) : milestone),
    }));
  };

  const removeMilestone = (id: string) => {
    onEdit((current) => ({ ...current, milestones: current.milestones.filter((milestone) => milestone.id !== id) }));
  };

  return (
    <div style={{ padding: "12px 14px 24px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 15, color: "var(--text)" }}>{project.name}</h2>
        <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{project.root}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <ProgressBar percent={progress.percent} />
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
          {progress.total
            ? t("projects.progress", { done: progress.done, total: progress.total, percent: progress.percent })
            : t("projects.noTasks")}
        </span>
      </div>

      {roadmap.milestones.map((milestone) => (
        <MilestoneCard
          key={milestone.id}
          milestone={milestone}
          collapsed={Boolean(collapsed[milestone.id])}
          onToggle={() => onToggle(milestone.id)}
          onChange={(change) => changeMilestone(milestone.id, change)}
          onRemove={() => removeMilestone(milestone.id)}
        />
      ))}

      <button
        onClick={addMilestone}
        style={{
          display: "flex", alignItems: "center", gap: 6, width: "100%",
          padding: "9px 12px", marginTop: 6,
          background: "none", border: "1px dashed var(--border)", borderRadius: 8,
          color: "var(--text-muted)", cursor: "pointer", fontSize: 12,
        }}
        onMouseEnter={(event) => { event.currentTarget.style.borderColor = "var(--accent)"; event.currentTarget.style.color = "var(--text)"; }}
        onMouseLeave={(event) => { event.currentTarget.style.borderColor = "var(--border)"; event.currentTarget.style.color = "var(--text-muted)"; }}
      >
        + {t("projects.addMilestone")}
      </button>
    </div>
  );
}

function MilestoneCard({
  milestone,
  collapsed,
  onToggle,
  onChange,
  onRemove,
}: {
  milestone: ProjectMilestone;
  collapsed: boolean;
  onToggle: () => void;
  onChange: (change: (milestone: ProjectMilestone) => ProjectMilestone) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const progress = milestoneProgress(milestone);
  const isDone = milestone.status === "done";

  const addTask = () => {
    const task: ProjectTask = { id: newItemId("t"), title: t("projects.newTask"), status: "todo" };
    onChange((current) => ({ ...current, tasks: [...current.tasks, task] }));
  };

  const changeTask = (id: string, change: (task: ProjectTask) => ProjectTask) => {
    onChange((current) => ({
      ...current,
      tasks: current.tasks.map((task) => task.id === id ? change(task) : task),
    }));
  };

  const removeTask = (id: string) => {
    onChange((current) => ({ ...current, tasks: current.tasks.filter((task) => task.id !== id) }));
  };

  return (
    <section
      style={{
        border: "1px solid var(--border)", borderRadius: 9, marginBottom: 10,
        background: "var(--bg-panel)", overflow: "hidden",
      }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 11px" }}>
        <button
          onClick={onToggle}
          aria-label={collapsed ? t("projects.expand") : t("projects.collapse")}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 18, height: 18, flexShrink: 0,
            background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer",
            transform: collapsed ? "rotate(-90deg)" : "none", transition: "transform 0.12s",
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        <input
          value={milestone.title}
          onChange={(event) => onChange((current) => ({ ...current, title: event.target.value }))}
          style={{
            flex: 1, minWidth: 0, padding: "2px 4px",
            background: "transparent", border: "1px solid transparent", borderRadius: 4,
            color: "var(--text)", fontSize: 13, fontWeight: 600,
            textDecoration: isDone ? "line-through" : "none",
          }}
          onFocus={(event) => { event.currentTarget.style.borderColor = "var(--border)"; }}
          onBlur={(event) => { event.currentTarget.style.borderColor = "transparent"; }}
        />
        <StatusSelect
          value={milestone.status}
          options={["planned", "in-progress", "done", "blocked"]}
          labels={{
            planned: t("projects.statusPlanned"),
            "in-progress": t("projects.statusInProgress"),
            done: t("projects.statusDone"),
            blocked: t("projects.statusBlocked"),
          }}
          onChange={(status) => onChange((current) => ({ ...current, status: status as MilestoneStatus }))}
        />
        <IconButton label={t("projects.removeMilestone")} onClick={onRemove}>×</IconButton>
      </header>

      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 11px 8px 37px" }}>
        <ProgressBar percent={progress.percent} small />
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
          {progress.total ? `${progress.done}/${progress.total}` : t("projects.noTasks")}
        </span>
        <input
          type="date"
          value={milestone.due ?? ""}
          onChange={(event) => onChange((current) => {
            const next = { ...current };
            if (event.target.value) next.due = event.target.value;
            else delete next.due;
            return next;
          })}
          style={{
            fontSize: 11, color: "var(--text-dim)", background: "transparent",
            border: "1px solid transparent", borderRadius: 4, padding: "1px 4px",
          }}
          onFocus={(event) => { event.currentTarget.style.borderColor = "var(--border)"; }}
          onBlur={(event) => { event.currentTarget.style.borderColor = "transparent"; }}
        />
      </div>

      {!collapsed && (
        <div style={{ padding: "0 11px 10px 37px" }}>
          {milestone.tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onChange={(change) => changeTask(task.id, change)}
              onRemove={() => removeTask(task.id)}
            />
          ))}
          <button
            onClick={addTask}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "5px 6px", marginTop: 2,
              background: "none", border: "none", color: "var(--text-dim)",
              cursor: "pointer", fontSize: 12,
            }}
            onMouseEnter={(event) => { event.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(event) => { event.currentTarget.style.color = "var(--text-dim)"; }}
          >
            + {t("projects.addTask")}
          </button>
        </div>
      )}
    </section>
  );
}

function TaskRow({
  task,
  onChange,
  onRemove,
}: {
  task: ProjectTask;
  onChange: (change: (task: ProjectTask) => ProjectTask) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const isDone = task.status === "done";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
      <input
        type="checkbox"
        checked={isDone}
        onChange={(event) => onChange((current) => ({
          ...current,
          status: event.target.checked ? "done" : "todo",
        }))}
        style={{ width: 13, height: 13, accentColor: "var(--accent)", cursor: "pointer", flexShrink: 0 }}
        aria-label={t("projects.toggleTask")}
      />
      <input
        value={task.title}
        onChange={(event) => onChange((current) => ({ ...current, title: event.target.value }))}
        style={{
          flex: 1, minWidth: 60, padding: "2px 4px",
          background: "transparent", border: "1px solid transparent", borderRadius: 4,
          color: isDone ? "var(--text-dim)" : "var(--text)", fontSize: 12,
          textDecoration: isDone ? "line-through" : "none",
        }}
        onFocus={(event) => { event.currentTarget.style.borderColor = "var(--border)"; }}
        onBlur={(event) => { event.currentTarget.style.borderColor = "transparent"; }}
      />
      <StatusSelect
        value={task.status}
        options={["todo", "doing", "done", "blocked"]}
        labels={{
          todo: t("projects.taskTodo"),
          doing: t("projects.taskDoing"),
          done: t("projects.statusDone"),
          blocked: t("projects.statusBlocked"),
        }}
        onChange={(status) => onChange((current) => ({ ...current, status: status as TaskStatus }))}
      />
      <input
        value={task.assignee ?? ""}
        placeholder={t("projects.assignee")}
        onChange={(event) => onChange((current) => {
          const next = { ...current };
          if (event.target.value.trim()) next.assignee = event.target.value.trim();
          else delete next.assignee;
          return next;
        })}
        style={{
          width: 76, padding: "2px 4px",
          background: "transparent", border: "1px solid transparent", borderRadius: 4,
          color: "var(--text-muted)", fontSize: 11,
        }}
        onFocus={(event) => { event.currentTarget.style.borderColor = "var(--border)"; }}
        onBlur={(event) => { event.currentTarget.style.borderColor = "transparent"; }}
      />
      <input
        type="date"
        value={task.due ?? ""}
        onChange={(event) => onChange((current) => {
          const next = { ...current };
          if (event.target.value) next.due = event.target.value;
          else delete next.due;
          return next;
        })}
        style={{
          fontSize: 11, color: "var(--text-dim)", background: "transparent",
          border: "1px solid transparent", borderRadius: 4, padding: "1px 2px",
        }}
        onFocus={(event) => { event.currentTarget.style.borderColor = "var(--border)"; }}
        onBlur={(event) => { event.currentTarget.style.borderColor = "transparent"; }}
      />
      <PrioritySelect
        value={task.priority}
        onChange={(priority) => onChange((current) => {
          const next = { ...current };
          if (priority) next.priority = priority;
          else delete next.priority;
          return next;
        })}
      />
      <IconButton label={t("projects.removeTask")} onClick={onRemove}>×</IconButton>
    </div>
  );
}

function StatusSelect({
  value,
  options,
  labels,
  onChange,
}: {
  value: string;
  options: readonly string[];
  labels: Record<string, string>;
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      style={{
        flexShrink: 0, padding: "2px 4px", fontSize: 11,
        background: "var(--bg)", color: "var(--text-muted)",
        border: "1px solid var(--border)", borderRadius: 4,
      }}
    >
      {options.map((option) => (
        <option key={option} value={option}>{labels[option] ?? option}</option>
      ))}
    </select>
  );
}

function PrioritySelect({
  value,
  onChange,
}: {
  value: TaskPriority | undefined;
  onChange: (priority: TaskPriority | undefined) => void;
}) {
  const { t } = useI18n();
  return (
    <select
      value={value ?? ""}
      onChange={(event) => onChange((event.target.value || undefined) as TaskPriority | undefined)}
      title={t("projects.priority")}
      style={{
        flexShrink: 0, padding: "2px 2px", fontSize: 11,
        background: "var(--bg)", color: value ? "var(--text-muted)" : "var(--text-dim)",
        border: "1px solid var(--border)", borderRadius: 4,
      }}
    >
      <option value="">{t("projects.noPriority")}</option>
      <option value="high">{t("projects.priorityHigh")}</option>
      <option value="medium">{t("projects.priorityMedium")}</option>
      <option value="low">{t("projects.priorityLow")}</option>
    </select>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 20, height: 20, flexShrink: 0, padding: 0,
        background: "none", border: "none", color: "var(--text-dim)",
        cursor: "pointer", fontSize: 14, lineHeight: 1,
      }}
      onMouseEnter={(event) => { event.currentTarget.style.color = "var(--text)"; }}
      onMouseLeave={(event) => { event.currentTarget.style.color = "var(--text-dim)"; }}
    >
      {children}
    </button>
  );
}

function ProgressBar({ percent, small }: { percent: number; small?: boolean }) {
  const height = small ? 4 : 6;
  return (
    <span
      style={{
        display: "inline-block", width: small ? 70 : 130, height,
        background: "var(--bg-hover)", borderRadius: 3, overflow: "hidden", flexShrink: 0,
      }}
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ display: "block", width: `${percent}%`, height: "100%", background: "var(--accent)" }} />
    </span>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>
      {text}
    </div>
  );
}

function SaveFooter({ state, error }: { state: SaveState; error: string | null }) {
  const { t } = useI18n();
  const label = useMemo(() => {
    if (state === "saving") return t("projects.saving");
    if (state === "saved") return t("projects.saved");
    if (state === "error") return t("projects.saveFailed");
    return "";
  }, [state, t]);
  if (!label && !error) return null;
  return (
    <div
      style={{
        flexShrink: 0, display: "flex", alignItems: "center", gap: 8,
        padding: "6px 12px", borderTop: "1px solid var(--border)",
        background: "var(--bg-panel)", fontSize: 11,
        color: state === "error" ? "var(--text-muted)" : "var(--text-dim)",
      }}
    >
      <span>{label}</span>
      {error && <span style={{ color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{error}</span>}
    </div>
  );
}
