import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  emptyRoadmap,
  milestoneProgress,
  newItemId,
  normalizeRoadmap,
  normalizeTask,
  roadmapProgress,
} = await jiti.import("./project-roadmaps-shared.ts");
const { readProjectRoadmaps, writeProjectRoadmap, deleteProjectRoadmap } = await jiti.import("./project-roadmaps.ts");

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
