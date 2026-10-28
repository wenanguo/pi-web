import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  parseCustomAgentDefinition,
  parseCustomAgentModel,
  parseCustomAgentTools,
  toCustomAgentSummary,
} = await jiti.import("./custom-agents-shared.ts");
const { readSessionCustomAgent, appendSessionCustomAgent } = await jiti.import("./custom-agent-selection.ts");
const { createCustomAgentExtension } = await jiti.import("./custom-agent-extension.ts");

test("reads a definition's frontmatter and uses its body as the persona", () => {
  const definition = parseCustomAgentDefinition(
    [
      "---",
      "name: reviewer",
      "display_name: 代码审查员",
      "description: 只读地审查改动",
      "thinking: high",
      "tools: [read, grep, diff]",
      "model: ppu/deepseek-v4-flash",
      "---",
      "",
      "你是审查员。",
    ].join("\n"),
    { id: "reviewer-file" },
  );
  assert.ok(definition);
  assert.equal(definition.id, "reviewer");
  assert.equal(definition.displayName, "代码审查员");
  assert.equal(definition.description, "只读地审查改动");
  assert.equal(definition.thinkingLevel, "high");
  assert.deepEqual(definition.tools, ["read", "grep", "diff"]);
  assert.deepEqual(definition.model, { provider: "ppu", modelId: "deepseek-v4-flash" });
  assert.equal(definition.modelRef, "ppu/deepseek-v4-flash");
  assert.equal(definition.prompt, "你是审查员。");
});

test("a missing name falls back to the file's id, and a tool list may be a string", () => {
  const definition = parseCustomAgentDefinition(
    ["---", "tools: read, bash", "---", "做事的规则"].join("\n"),
    { id: "helper" },
  );
  assert.ok(definition);
  assert.equal(definition.id, "helper");
  assert.equal(definition.displayName, "helper");
  assert.deepEqual(definition.tools, ["read", "bash"]);
  assert.equal(definition.prompt, "做事的规则");
});

test("a definition with no persona, or an unusable id, is not a definition", () => {
  assert.equal(parseCustomAgentDefinition("", { id: "empty" }), undefined);
  // A file without frontmatter is still a definition: its body is the persona.
  const plain = parseCustomAgentDefinition("只是人格", { id: "plain" });
  assert.equal(plain?.id, "plain");
  assert.equal(plain?.prompt, "只是人格");
  assert.equal(
    parseCustomAgentDefinition(["---", "name: not a name", "---", "x"].join("\n"), { id: "x" }),
    undefined,
  );
});

test("an empty tool list means no tools, and a missing one means no narrowing", () => {
  assert.deepEqual(parseCustomAgentTools([]), []);
  assert.equal(parseCustomAgentTools(undefined), undefined);
  assert.deepEqual(parseCustomAgentTools("read, read, bash"), ["read", "bash"]);
});

test("a model reference is provider/model, or a bare model id", () => {
  assert.deepEqual(parseCustomAgentModel("ppu/glm-5.3"), {
    model: { provider: "ppu", modelId: "glm-5.3" },
    modelRef: "ppu/glm-5.3",
  });
  assert.deepEqual(parseCustomAgentModel("glm-5.3"), {
    model: { provider: "", modelId: "glm-5.3" },
    modelRef: "glm-5.3",
  });
  assert.equal(parseCustomAgentModel(undefined), undefined);
});

test("the summary the browser gets carries no persona", () => {
  const summary = toCustomAgentSummary({
    id: "reviewer",
    displayName: "审查员",
    description: "只读",
    model: { provider: "ppu", modelId: "glm-5.3" },
    modelRef: "ppu/glm-5.3",
    prompt: "SECRET PERSONA",
  });
  assert.equal("prompt" in summary, false);
  assert.equal(summary.modelRef, "ppu/glm-5.3");
});

test("the session's agent is read from its newest valid entry", () => {
  const entries = [
    { type: "custom", customType: "pi-web:custom-agent", data: { version: 1, agent: "first" } },
    { type: "custom", customType: "pi-web:custom-agent", data: { version: 1, agent: "second" } },
  ];
  assert.equal(readSessionCustomAgent(entries), "second");
  assert.equal(readSessionCustomAgent([{ type: "custom", customType: "other", data: {} }]), undefined);
  assert.equal(readSessionCustomAgent([{ type: "custom", customType: "pi-web:custom-agent", data: { version: 2 } }]), undefined);
});

test("the agent is written into the session as a custom entry", () => {
  const written = [];
  appendSessionCustomAgent(
    { appendCustomEntry: (customType, data) => written.push({ customType, data }) },
    "reviewer",
  );
  assert.deepEqual(written, [
    { customType: "pi-web:custom-agent", data: { version: 1, agent: "reviewer" } },
  ]);
});

test("the extension appends the persona to pi's prompt and keeps the agent's tools", async () => {
  const handlers = [];
  let activeTools = [];
  const pi = {
    on: (event, handler) => {
      handlers.push({ event, handler });
      return () => {};
    },
    getAllTools: () => [
      { name: "read", exposure: "direct" },
      { name: "bash", exposure: "direct" },
      { name: "gone", exposure: "hidden" },
    ],
    setActiveTools: (names) => {
      activeTools = names;
    },
  };
  await createCustomAgentExtension({
    getPrompt: () => "  你是分析助手。  ",
    getTools: () => ["read", "gone"],
  }).factory(pi);

  const handler = handlers.find((entry) => entry.event === "before_agent_start").handler;
  const result = await handler({ systemPrompt: "PI'S OWN PROMPT" }, {});
  assert.equal(result.systemPrompt, "PI'S OWN PROMPT\n\n你是分析助手。");
  // A hidden tool stays out even when the agent names it.
  assert.deepEqual(activeTools, ["read"]);
});

test("the extension sends nothing when the agent has no persona", async () => {
  const handlers = [];
  const pi = {
    on: (event, handler) => {
      handlers.push({ event, handler });
      return () => {};
    },
    getAllTools: () => [],
    setActiveTools: () => {},
  };
  await createCustomAgentExtension({ getPrompt: () => undefined }).factory(pi);
  const handler = handlers.find((entry) => entry.event === "before_agent_start").handler;
  assert.equal(await handler({ systemPrompt: "PI'S OWN PROMPT" }, {}), undefined);
});

test("the fork's directory holds the personas, read from disk", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-custom-agent-"));
  mkdirSync(join(dir, "agents"));
  writeFileSync(
    join(dir, "agents", "one.md"),
    ["---", "name: one", "---", "第一个角色"].join("\n"),
  );
  writeFileSync(
    join(dir, "agents", "broken.md"),
    ["---", "name: broken", "---"].join("\n"),
  );
  const previous = process.env.PI_WEB_CUSTOM_AGENT_DIR;
  process.env.PI_WEB_CUSTOM_AGENT_DIR = dir;
  try {
    const { listCustomAgents, resolveCustomAgent } = await jiti.import("./custom-agents.ts");
    const agents = listCustomAgents();
    assert.equal(agents.length, 1);
    assert.equal(agents[0].id, "one");
    assert.equal(agents[0].prompt, "第一个角色");
    assert.equal(resolveCustomAgent("ONE")?.id, "one");
    assert.equal(resolveCustomAgent("missing"), undefined);
  } finally {
    if (previous === undefined) delete process.env.PI_WEB_CUSTOM_AGENT_DIR;
    else process.env.PI_WEB_CUSTOM_AGENT_DIR = previous;
  }
});
