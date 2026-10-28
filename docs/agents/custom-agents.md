# 定制 agent（Custom agents）

定制 agent 是这个分叉加的能力：一组随仓库走的角色，每个角色 = **人格**（Markdown）
+ **能力**（pi 扩展）。在新建会话时挑一个角色，这一轮的人格、模型和工具就定了。

## 目录与文件

| 位置 | 作用 |
| --- | --- |
| `custom-agent/agents/*.md` | 人格定义。frontmatter + 正文。 |
| `custom-agent/extensions/**` | 能力扩展（普通 pi 扩展）。 |
| `custom-agent/knowledge/*.md` | 能力扩展默认读的知识库（示例扩展用）。 |
| `lib/custom-agents-shared.ts` | 定义的解析（纯函数，浏览器与服务端共用）。 |
| `lib/custom-agents.ts` | 读目录：角色列表、角色解析、能力扩展路径枚举。 |
| `lib/custom-agent-selection.ts` | 会话文件里的 `pi-web:custom-agent` 条目。 |
| `lib/custom-agent-extension.ts` | 人格注入 + 工具白名单的扩展工厂。 |
| `lib/custom-agent-preference.ts` | 浏览器记住的角色选择（localStorage）。 |
| `app/api/custom-agents/route.ts` | `GET` 角色列表（不含人格正文）。 |
| `components/CustomAgentSelector.tsx` | 角色选择器。 |
| `docs/custom-agents.md` | 使用与编写指南。 |

## 定义格式

frontmatter：`name`（id，回退到文件名）、`display_name`、`description`、`thinking`、
`tools`（数组或逗号串；**缺失 = 不限制**，空数组 = 无工具）、`model`（`provider/modelId`）。
人格正文 = frontmatter 之后的 Markdown（`system_prompt` 优先）。

一个解析失败的文件只会被跳过并记一条日志，不影响其它角色。

## 人格怎么进模型

`lib/custom-agent-extension.ts` 注册一个 `before_agent_start` 处理器，返回
`{ systemPrompt: event.systemPrompt + 人格 }`：**追加**在 pi 自己的提示词之后，不是替换
（pi 的提示词带工具规则和技能目录）。处理器每次运行都跑，所以人格对重开的会话也有效
（转录重放的是 pi 自己的段落，人格每次再追加一次）。

改 `agent.state.systemPrompt` 是**不行**的：Pi 0.86+ 那个字段是从转录重放的 getter，
赋值会抛。见 `lib/exact-system-prompt.ts` 的注释。

## 工具白名单

角色点名了 `tools:` 时，它是**精确**集合：

- 建会话后 `inner.setActiveToolsByName(...)` 先收一次（`lib/rpc-manager.ts`）。
- 每次运行前扩展再收一次（`pi.setActiveTools(...)`）：pi 会自动激活后来注册的扩展工具
  （比如延迟注册的 MCP 工具），不在名单里的必须停掉。
- `exposure: "hidden"` 的工具即使被点名也不给。

没写 `tools:` 的角色不收窄，跟随 pi 的默认工具集（和工具预设同一套逻辑）。

## 能力扩展怎么加载

`resourceLoaderOptions.additionalExtensionPaths` **只对跑着定制 agent 的会话**传，普通会话
的加载跟上游一模一样。

SDK 把这个路径上的**目录**当成一个扩展包（要根目录有 `index.ts` 或 `package.json`
清单），不会扫描子目录。所以 `lib/custom-agents.ts` 自己按 SDK 的发现规则枚举文件：
目录下的 `*.ts` / `*.js`，以及一层子目录里的 `index.ts` / `index.js`，然后逐个传路径。

## 会话与浏览器

- 会话文件记着角色（`pi-web:custom-agent` 自定义条目，`lib/custom-agent-selection.ts`），
  和工具预设的 `pi-web:tool-selection` 同一套做法。重开会话仍是这个角色。
- `GET /api/sessions/[id]` 带上 `customAgent`，界面因此显示会话的角色。
- 浏览器记住的只是"新建会话默认用哪个角色"（`pi-custom-agent`，localStorage）。
- 会话跑起来后不能再换角色：界面只在**全新会话**里给选择器，已有的会话只显示角色名。
  选角色的会话里，工具预设按钮是灰的（角色说了算）。

## 模型

角色的 `model` 是**默认**：用户在界面选的模型优先。没选时用角色的模型，且允许回退到
scope 内另一个可用模型（`allowInitialModelFallback`）。角色的 `thinking` 同理。

## 边界

- 不改 pi 本身：系统提示词、工具行为、上下文管理都还是 pi 的。
- 角色不是 pi 的 agent profile（`~/.pi/agent/agents/*.md`）：那套是**子 agent**，
  由模型自己调用；定制 agent 是**主会话**的身份。两者可以共存。
- 扩展是普通 pi 扩展，CLI 里也能用；这里只多了"随仓库走 + 界面选择器"。

## 测试

`lib/custom-agents.test.mjs`：定义解析、模型引用、工具列表、会话条目、人格追加、
工具白名单、目录读取。
