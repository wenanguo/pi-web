# custom-agent/

这个目录是**定制 agent**的家，跟仓库一起走：

| 目录 | 放什么 |
| --- | --- |
| `agents/*.md` | **人格**：一个文件一个角色。frontmatter 写 id、显示名、模型、思考级别和工具白名单，正文是角色的做事方式。 |
| `extensions/**` | **能力**：普通的 pi 扩展（`*.ts` / `*/index.ts`），角色点名它们的工具才拿得到。 |
| `knowledge/*.md` | 能力扩展默认读的知识库（示例扩展 `knowledge_search` 读这里）。 |

写法和用法见 [docs/custom-agents.md](../docs/custom-agents.md)。

## 仓库里现成的两个例子

- `agents/risk-officer.md` —— **项目风控官**：只读审计项目，产出 P0/P1/P2 分级风险清单。
- `extensions/risk-scanner/` —— 配套能力 `risk_scan`：扫硬编码凭据、未锁定依赖版本、
  遗留调试语句、TODO/FIXME、大文件，只读不改。
- `agents/example-analyst.md` —— 最小人格模板。

照着 `risk-officer.md` 改，比从空白开始快。

## 三条约定

1. **人格追加，不替换。** 角色的正文加在 pi 自己的系统提示词之后，pi 的工具规则和技能目录
   都还在。想换 pi 的行为，去改 pi，不要在这里重写。
2. **工具是点名制。** 角色不点名的扩展工具不会到模型手上；点了名的扩展工具在会话里
   一直是活跃的（会话跑起来后角色不能再换）。
3. **能力就是 pi 扩展。** 同一份代码在 pi CLI 里也能加载，不要用 Pi Web 私有的 API。

## 目录位置

默认是运行 Pi Web 的那个目录下的 `custom-agent/`。从别处启动时用
`PI_WEB_CUSTOM_AGENT_DIR` 指过来。
