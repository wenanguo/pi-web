# 定制 agent 的知识库

`custom-agent/knowledge/*.md` 里的每个文件都是一条知识。`knowledge_search` 工具按行
匹配这些文件，返回命中行前后各两行，并把文件名和行号一起给模型。

这是能力扩展（`custom-agent/extensions/`）读数据的默认位置。把文件删掉，工具就
返回「没有匹配」；把新的 `.md` 放进去，工具下次调用就能看到。

写知识时的两条约定：

- 一个文件一个主题，文件名就是标题（`deployment.md` → “deployment”）。
- 事实和命令写具体：路径、命令、版本号。模型照着做，不需要再猜。
