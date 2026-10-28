# 项目面板（Projects panel）

右侧面板的第一个标签页：项目 → 里程碑 → 任务。可编辑，存应用自己的文件。

## 文件

| 位置 | 作用 |
| --- | --- |
| `lib/project-roadmaps-shared.ts` | 类型、校验、进度计算（浏览器与服务端共用）。 |
| `lib/project-roadmaps.ts` | `pi-web-projects.json` 的读写：加锁、原子写、损坏文件备份。 |
| `app/api/projects/route.ts` | `GET` 项目与计划；`PUT` 写一个项目的计划；`DELETE` 忘掉一个项目的计划。 |
| `components/ProjectsPanel.tsx` | 面板：项目切换、里程碑卡片、任务行。 |
| `docs/projects.md` | 使用说明。 |

## 项目从哪来

项目 = 跑过会话的目录，和左侧栏的项目分组是同一套身份（`projectKey`，Windows 下
大小写和分隔符不敏感）。`GET /api/projects` 用会话目录算出项目（按最近活动排序），
再把每个项目的计划贴上去。

**没有会话的项目不在列表里**：这个面板不维护自己的项目清单，用户没在这个目录里跑过
会话，就没人知道该给它建计划。

## 数据模型

`ProjectRoadmap` → `milestones[]` → `tasks[]`。字段、状态取值和校验都在
`lib/project-roadmaps-shared.ts`：

- 里程碑状态：`planned` / `in-progress` / `done` / `blocked`。
- 任务状态：`todo` / `doing` / `done` / `blocked`；优先级 `low` / `medium` / `high`。
- 校验是**宽容但严格**：没有标题的里程碑或任务直接丢掉，状态不认识就退回默认值，
  日期只认 `YYYY-MM-DD`，别的字段不保留。服务端的 `PUT` 用同一个函数校验，所以
  浏览器和服务端对「什么算一个任务」的看法一致。
- 项目键必须有：没有它，计划不知道该归在哪个项目下。

## 存储

`~/.pi/agent/pi-web-projects.json`，和侧边栏的 `pi-web-session-state.json` 放在一起。
写入：`serializeByKey` 串行化（进程内）→ `proper-lockfile` 跨进程锁 → 先读再改 →
`writePrivateFileAtomicSync` 原子替换 → 修订号 +1。

整份文件替换，所以两个项目同时写不会互相丢：第二次写会在锁内读到第一次的结果。
读不出来（文件损坏）的文件读成空，**不会在读的时候被改写**；写的时候会被挪到
`pi-web-projects.json.corrupt-<时间>` 备份。

**项目目录里一个字节都不写**：计划是用户的状态，和代码分开。

## 面板行为

- 面板是右侧面板的常驻标签（`PROJECTS_TAB_ID`），不可关闭，在文件标签之前。
- 项目切换用顶部的卡片；当前项目由 shell 的 `activeCwd` 推出来（目录匹配项目根，
  Windows 下忽略大小写），匹配不到就用最近活动的那个。
- 改动先进本地 state，600 ms 后 `PUT`；面板底部显示保存状态，失败时错误留在底部。
- 关闭面板时未落盘的定时器被清掉：**最后 600 ms 内的编辑会丢**。要保证不丢，
  改完等一下保存提示出现。

## 和对话连起来

任务行的**对话气泡**把任务带进输入框：`chatInputRef.current.insertText(text)` +
`focus()`（AppShell 里 `handleOpenTaskInChat`）。走的是文件 @ 提及那条路（同一个
`ChatInputHandle`），所以草稿、撤回、换项目时停放草稿的规则全都一样。

带过去的是 `formatTaskContext()`（`lib/project-roadmaps-shared.ts`）写的任务上下文：
任务、项目（名字 + 根目录）、里程碑、状态/负责人/截止/优先级，末尾留一个空行给用户
自己的话。**会话目录和任务项目不是同一个时，会话目录也写进去**：模型在那个目录里
干活，任务在别处，得说清楚。

气泡旁的 **▾** 菜单是三条常用指令（扩展/总结/拆解），每条都是「上下文 + 指令」，
仍进输入框，可以改完再发。指令是界面文案，在 i18n 里。

任务标题本身是输入框（要能改名），所以点标题是编辑，不是带入对话。

## 边界

- 这是给人看的计划板，不是看板工具：没有拖拽排序、没有甘特图、没有多人协作。
- 任务是扁平的列表，没有子任务、没有依赖关系。
- 项目的身份来自会话目录；一个目录删了，项目和它的计划一起从列表里消失（计划还在
  文件里，换回同名项目会回来）。
