import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  emptyRoadmap,
  formatTaskContext,
  milestoneProgress,
  newItemId,
  normalizeRoadmap,
  normalizeTask,
  roadmapProgress,
} = await jiti.import("./project-roadmaps-shared.ts");
const { readProjectRoadmaps, writeProjectRoadmap, deleteProjectRoadmap, applyProjectRoadmapOperation } = await jiti.import("./project-roadmaps.ts");

test("a roadmap needs a project key, and one without a title is not a milestone", () => {
  assert.equal(normalizeRoadmap({ milestones: [] }), undefined);
  assert.equal(normalizeRoadmap({ projectKey: "p", milestones: [] }).milestones.length, 0);
  assert.equal(normalizeRoadmap({ projectKey: "p", milestones: [{ title: "   " }] }).milestones.length, 0);
  assert.equal(normalizeRoadmap({ projectKey: "p", milestones: [{ title: "M1" }] }).milestones.length, 1);
});

test("a task without a title is not a task, and the status falls back to todo", () => {
  assert.equal(normalizeTask({ title: "" }, 0), undefined);
  const task = normalizeTask({ title: "写文档", status: "nonsense" }, 0);
  assert.equal(task.status, "todo");
  assert.equal(task.title, "写文档");
  assert.equal(task.id, "task-0");
});

test("a task keeps only what it knows: owner, date and priority", () => {
  const task = normalizeTask({
    title: "写文档",
    assignee: "我",
    due: "2026-11-15",
    priority: "high",
    nonsense: true,
  }, 0);
  assert.equal(task.assignee, "我");
  assert.equal(task.due, "2026-11-15");
  assert.equal(task.priority, "high");
  assert.equal("nonsense" in task, false);

  const odd = normalizeTask({ title: "x", due: "15/11/2026", priority: "urgent" }, 0);
  assert.equal(odd.due, undefined);
  assert.equal(odd.priority, undefined);
});

test("progress counts the done tasks", () => {
  const roadmap = normalizeRoadmap({
    projectKey: "p",
    milestones: [
      { id: "m1", title: "M1", tasks: [
        { id: "t1", title: "a", status: "done" },
        { id: "t2", title: "b", status: "doing" },
        { id: "t3", title: "c", status: "done" },
      ] },
      { id: "m2", title: "M2", tasks: [] },
    ],
  });
  assert.deepEqual(roadmapProgress(roadmap), { total: 3, done: 2, percent: 66 });
  assert.deepEqual(milestoneProgress(roadmap.milestones[0]), { total: 3, done: 2, percent: 66 });
  assert.deepEqual(milestoneProgress(roadmap.milestones[1]), { total: 0, done: 0, percent: 0 });
});

test("an empty roadmap is a project without a plan", () => {
  assert.deepEqual(emptyRoadmap("p"), { projectKey: "p", milestones: [] });
  assert.deepEqual(emptyRoadmap("p", "名字"), { projectKey: "p", projectName: "名字", milestones: [] });
});

test("item ids are unique and carry their kind", () => {
  const first = newItemId("m");
  const second = newItemId("m");
  assert.notEqual(first, second);
  assert.ok(first.startsWith("m-"));
});

test("a roadmap is written, read back and removed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-roadmaps-"));
  const path = join(dir, "pi-web-projects.json");
  const roadmap = normalizeRoadmap({
    projectKey: "d:\\project\\pi-web",
    milestones: [{ id: "m1", title: "第一阶段", tasks: [{ id: "t1", title: "任务", status: "doing" }] }],
  });

  const written = await writeProjectRoadmap(roadmap, path);
  assert.equal(written.revision, 1);
  assert.equal(written.projects["d:\\project\\pi-web"].milestones.length, 1);

  const read = readProjectRoadmaps(path);
  assert.equal(read.revision, 1);
  assert.equal(read.projects["d:\\project\\pi-web"].milestones[0].tasks[0].title, "任务");

  // A second project's roadmap leaves the first one alone.
  const other = normalizeRoadmap({ projectKey: "other", milestones: [] });
  const second = await writeProjectRoadmap(other, path);
  assert.equal(second.revision, 2);
  assert.equal(second.projects["d:\\project\\pi-web"].milestones.length, 1);
  assert.equal(second.projects.other.milestones.length, 0);

  const removed = await deleteProjectRoadmap("other", path);
  assert.equal(removed.revision, 3);
  assert.equal("other" in removed.projects, false);
  assert.equal(removed.projects["d:\\project\\pi-web"].milestones.length, 1);

  // The file on disk is the one that was written.
  const onDisk = JSON.parse(readFileSync(path, "utf-8"));
  assert.equal(onDisk.version, 1);
  assert.equal(onDisk.revision, 3);
});

test("a file that cannot be parsed reads as empty, and is not thrown away on a write", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-roadmaps-broken-"));
  const path = join(dir, "pi-web-projects.json");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(path, "{ not json");
  assert.deepEqual(readProjectRoadmaps(path).projects, {});
  const roadmap = normalizeRoadmap({ projectKey: "p", milestones: [] });
  const written = await writeProjectRoadmap(roadmap, path);
  assert.equal(written.projects.p.projectKey, "p");
});

test("a missing file reads as empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-roadmaps-missing-"));
  const read = readProjectRoadmaps(join(dir, "nothing.json"));
  assert.deepEqual(read.projects, {});
  assert.equal(read.revision, 0);
});

test("changes are applied to the plan as it is at that moment", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-roadmaps-ops-"));
  const path = join(dir, "pi-web-projects.json");
  const key = "d:\\project\\pi-web";

  const added = await applyProjectRoadmapOperation(key, {
    kind: "add-milestone",
    title: "第一阶段",
  }, path);
  assert.equal(added.ok, true);
  assert.equal(added.roadmap.milestones.length, 1);

  const task = await applyProjectRoadmapOperation(key, {
    kind: "add-task",
    milestone: "第一阶段",
    title: "写代码",
    status: "doing",
    priority: "high",
  }, path);
  assert.equal(task.ok, true);
  assert.equal(task.roadmap.milestones[0].tasks.length, 1);
  assert.equal(task.roadmap.milestones[0].tasks[0].status, "doing");
  assert.equal(task.roadmap.milestones[0].tasks[0].priority, "high");

  const updated = await applyProjectRoadmapOperation(key, {
    kind: "update-task",
    id: task.roadmap.milestones[0].tasks[0].id,
    status: "done",
  }, path);
  assert.equal(updated.ok, true);
  assert.equal(updated.roadmap.milestones[0].tasks[0].status, "done");

  const unknown = await applyProjectRoadmapOperation(key, {
    kind: "update-task",
    id: "nope",
    status: "done",
  }, path);
  assert.equal(unknown.ok, false);
});

test("changes made at the same time do not lose each other", async () => {
  // The model sends three "add a task" calls in one message, pi runs them at the
  // same time: each of them reads the plan, changes it and writes it back. A
  // change that replaced the whole plan would lose the other two.
  const dir = mkdtempSync(join(tmpdir(), "pi-web-roadmaps-parallel-"));
  const path = join(dir, "pi-web-projects.json");
  const key = "d:\\project\\pi-web";
  await applyProjectRoadmapOperation(key, { kind: "add-milestone", title: "第一阶段" }, path);

  await Promise.all([
    applyProjectRoadmapOperation(key, { kind: "add-task", milestone: "第一阶段", title: "任务 A" }, path),
    applyProjectRoadmapOperation(key, { kind: "add-task", milestone: "第一阶段", title: "任务 B" }, path),
    applyProjectRoadmapOperation(key, { kind: "add-task", milestone: "第一阶段", title: "任务 C" }, path),
  ]);

  const read = readProjectRoadmaps(path);
  const tasks = read.projects[key].milestones[0].tasks.map((task) => task.title);
  assert.equal(tasks.length, 3);
  assert.deepEqual([...tasks].sort(), ["任务 A", "任务 B", "任务 C"]);
});

test("a status the plan does not know falls back to the default", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-roadmaps-status-"));
  const path = join(dir, "pi-web-projects.json");
  const key = "p";
  const result = await applyProjectRoadmapOperation(key, {
    kind: "add-task",
    milestone: "M",
    title: "T",
    status: "nonsense",
    priority: "urgent",
  }, path);
  assert.equal(result.roadmap.milestones[0].tasks[0].status, "todo");
  assert.equal(result.roadmap.milestones[0].tasks[0].priority, undefined);
});

test("the task context names the task, its project, its milestone and where it stands", () => {
  const labels = {
    task: "任务",
    project: "项目",
    milestone: "里程碑",
    status: "状态",
    owner: "负责人",
    due: "截止",
    priority: "优先级",
    sessionDirectory: "会话目录",
    statusValues: { done: "已完成" },
    priorityValues: { high: "高" },
  };
  const text = formatTaskContext({
    projectName: "pi-web",
    projectRoot: "D:\\project\\pi-web",
    milestone: { title: "定制 agent 体系" },
    task: { title: "项目管理界面", status: "done", assignee: "我", due: "2026-11-15", priority: "high" },
    sessionCwd: "D:\\project\\pi-web",
  }, labels);
  assert.equal(text, [
    "任务: 项目管理界面",
    "项目: pi-web (D:\\project\\pi-web)",
    "里程碑: 定制 agent 体系",
    "状态: 已完成 | 负责人: 我 | 截止: 2026-11-15 | 优先级: 高",
    "",
    "",
  ].join("\n"));
});

test("the task context names the session's directory when it is another one", () => {
  const labels = {
    task: "Task", project: "Project", milestone: "Milestone", status: "Status",
    owner: "Owner", due: "Due", priority: "Priority", sessionDirectory: "Session directory",
  };
  const text = formatTaskContext({
    projectName: "pi-web",
    projectRoot: "D:\\project\\pi-web",
    task: { title: "写文档", status: "todo" },
    sessionCwd: "D:\\other\\project",
  }, labels);
  assert.ok(text.includes("Session directory: D:\\other\\project"));
  assert.ok(text.includes("Status: todo"));

  // The same directory in another case is the same directory.
  const same = formatTaskContext({
    projectName: "pi-web",
    projectRoot: "d:\\project\\pi-web",
    task: { title: "写文档", status: "todo" },
    sessionCwd: "D:\\project\\pi-web",
  }, labels);
  assert.equal(same.includes("Session directory"), false);
});
