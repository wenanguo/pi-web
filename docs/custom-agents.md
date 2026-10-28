# 定制 agent

Pi Web 的这个分叉带了**定制 agent**：一组随仓库走的角色，每个角色有自己的
**人格**（Markdown）和**能力**（pi 扩展），在新建会话时挑一个就能用。

```
custom-agent/
  agents/        # 人格：一个 .md 一个角色
  extensions/    # 能力：pi 扩展，角色可以调用它们注册的工具
  knowledge/     # 能力扩展默认读的数据目录
```

- 人格 = 这个角色是谁、要怎么做事、允许用哪些工具、用哪个模型。
- 能力 = 这个角色**能做什么**：一个扩展注册一个工具，角色在 `tools:` 里点名才拿得到。

角色目录跟着仓库走，所以团队里每个人拉下代码就有同一批角色；要改角色，改
Markdown 提交上去就行。

---

## 仓库里现成的例子

| 文件 | 是什么 |
| --- | --- |
| `custom-agent/agents/risk-officer.md` | **项目风控官**：只读审计、产出分级风险清单的完整角色（定级标准、固定卡片格式、硬规矩）。 |
| `custom-agent/extensions/risk-scanner/index.ts` | 配套能力：`risk_scan` 工具，扫硬编码凭据、未锁定依赖版本、遗留调试语句、TODO/FIXME、大文件。 |
| `custom-agent/agents/project-pm.md` | **项目经理助理**：读项目的计划，拆任务、改状态，**把产出写回计划**。 |
| `custom-agent/extensions/project-plan/index.ts` | 配套能力：`project_plan_read` / `add_milestone` / `add_task` / `update_task` 四个计划工具。 |
| `custom-agent/agents/example-analyst.md` | 最小人格模板：frontmatter + 一段做事方式。 |

`risk_scan` 的参数：

| 参数 | 含义 |
| --- | --- |
| `root` | 扫描根目录，相对会话的工作目录。默认当前目录。 |
| `kinds` | 只扫哪几类：`secret` / `dependency` / `debug` / `todo` / `large`。默认全扫。 |

风控官的人格要求**按用户问的范围选 `kinds`**：问依赖版本就只传 `["dependency"]`，
这样扫描结果不会把其它类型的噪音一起端上来。

## 能力扩展怎么拿到应用的数据

扩展在 Pi Web 的进程里跑，但它**不能 import 这个应用的模块**（扩展在 pi CLI 里也得能用）。
所以应用把需要的东西通过一个全局注册表交出来：

```typescript
const registry = globalThis[Symbol.for("pi-web/project-roadmaps/v1")];
```

`custom-agent/extensions/project-plan/` 就是这么拿到项目计划的（读当前会话所属项目的
计划，改它）。注册表不在（比如在 pi CLI 里）时，工具会说「计划只在 Pi Web 里可用」，
而不是抛异常。

扩展要写应用自己的文件时，**发一个操作**（add-task、update-task……），别发整份计划：
pi 会把一条消息里的多个工具调用**并行**执行，三次「读整份、改整份、写整份」会互相覆盖。
操作是在锁内应用到「当时磁盘上的那份计划」上的，三次并行不会丢。

---

## 写一个角色

`custom-agent/agents/reviewer.md`：

```markdown
---
name: reviewer
display_name: 代码审查员
description: 只读地审查改动，给出可执行的问题清单
thinking: high
tools:
  - read
  - grep
  - find
  - ls
  - diff_tool
---

你是这个仓库的代码审查员。

- 只读。不改文件，不执行会改变仓库状态的命令。
- 每个问题都要指到文件和行。
- 按严重程度排序，最严重的在前。
```

frontmatter 字段：

| 字段 | 含义 |
| --- | --- |
| `name` | 角色的 id（小写字母、数字、`-`、`.`、`_`）。不写就用文件名。 |
| `display_name` | 界面上显示的名字。不写就用 `name`。 |
| `description` | 一句话说明这个角色干什么用，显示在选择器里。 |
| `thinking` | 推理级别：`off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`。 |
| `tools` | 这个角色可以调用的工具名。**不写 = 不限制**（跟随 pi 的默认工具集）；写空数组 = 一个工具都不能用。 |
| `model` | 默认模型，`provider/modelId`（如 `ppu/deepseek-v4-flash`）。用户在界面上选的模型优先。 |

**人格正文**就是 frontmatter 之后的 Markdown。它会**追加**在 pi 自己的系统提示词
之后，而不是替换它 —— pi 的提示词带着工具规则和技能目录，角色只是换了个身份。

---

## 写一个能力

能力就是普通的 pi 扩展，放在 `custom-agent/extensions/`：

```
custom-agent/extensions/
  diff-tool/index.ts        # 一个目录一个扩展
  another-tool.ts           # 或直接一个文件
```

`custom-agent/extensions/diff-tool/index.ts`：

```typescript
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function diffTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "diff_tool",
    label: "Diff",
    description: "Show the uncommitted diff of a file in the repository.",
    parameters: Type.Object({ path: Type.String() }),
    execute: async (_id, args) => ({
      content: [{ type: "text", text: `…the diff of ${args.path}…` }],
      details: undefined,
    }),
  });
}
```

写好后：

1. 在角色的 `tools:` 里点名 `diff_tool`，模型才能调用它；
2. 角色不点的扩展工具不会出现在模型手上。

> 扩展是 pi 扩展，不是 Pi Web 私有的东西：同一份代码在 pi CLI 里也能用。写法见
> `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md` 和它自带的
> `examples/extensions/`。

---

## 怎么用

1. 打开一个新的会话（左边栏的「新建」）。
2. 在输入框下面的控制条上点**角色**按钮，选一个角色。
3. 正常说话。角色的人格、模型和工具从这一刻起就是这个会话的。

角色是**会话的一部分**，不是界面的临时状态：

- 会话文件里记着它（`pi-web:custom-agent` 条目），所以关掉再打开，还是这个角色。
- 会话跑起来之后不能再换角色 —— 人格已经进了这一轮的上下文。要换角色就开新会话。

工具预设（Tools 那一项）在选了角色之后是灰的：角色的 `tools:` 说了算。

---

## 目录位置

角色目录默认是**运行 Pi Web 的那个目录**下的 `custom-agent/`。从别的地方启动服务时，
用环境变量指过去：

```bash
PI_WEB_CUSTOM_AGENT_DIR=/path/to/custom-agent npm run dev
```

---

## 常见问题

**角色没出现在选择器里？**
`GET /api/custom-agents` 会列出全部角色。空的话多半是目录不对，或者 `.md` 解析失败
（服务端日志里会有 `ignoring the custom agent …`）。

**模型看不到某个工具？**
工具名要在角色的 `tools:` 里一字不差地写出来；扩展里的 `name` 就是模型调用的名字。

**角色提示词里写的规则模型不听？**
人格是追加在 pi 的提示词之后的，不是替换。角色正文里写清楚"只做什么、不做什么"
比写大段说明有用。

**改了 `.md`，会话里的角色还是旧的？**
会话已经跑起来了，它的人格是那一轮定下的。新建会话才会用上新的正文。
