# The Heart of the Creator / NovelOS

面向 FeelFish 的中文商业网文多智能体创作系统。它不是把 Agent、Skills 和 MCP 全部常驻，而是由主智能体按任务组建最小团队：市场、故事、人物、章节、正文、硬逻辑、叙事编辑、状态、研究与工具彼此分工，共享文件状态。

当前版本定位为可直接投入新书生产的公开版。默认面向番茄式移动阅读场景，重点控制慢节奏、模板化情绪、角色同声、连续性错误、重复句式、标点失衡、长段落和无效多模型返工。模型效果与平台价格会变化，公开路由是 2026-09 的生产快照，不代表永久排名，也不保证收益。

## 快速开始

1. 下载或克隆本仓库。
2. 在 FeelFish 中把仓库根目录作为“小说项目”打开。
3. 选择自定义方案 `NovelOS 番茄超级写作者`，主智能体应为 `NovelOS 总导演`。
4. 新书先让总导演执行“立项”，填写 `NovelOS/01-market/reader-contract.md`；随后可以直接要求它完成总纲、前三章设计或单章生产。
5. 如需本地确定性工具，把 `NovelOS/tools/mcp-server/mcp-config.template.json` 中的 `<PROJECT_ROOT>` 替换为本仓库绝对路径后，在 FeelFish 的 MCP/工具设置中添加。只把这组工具授予 `novelos-tool-operator`。

配置文件：

- 当前模型覆盖：`.feelfish/solution.json`
- 可导入方案：`.feelfish/solutions/feelfish-custom.json`
- 11 个 Agent：`.feelfish/agents/`
- Skills：`.feelfish/skills/`
- 小说工程状态：`NovelOS/`
- 七个受限 MCP 工具：`NovelOS/tools/mcp-server/`

## 生产模型路由

| Agent | 默认模型 | 思考 | 温度 | 静态 Skill |
|---|---|---:|---:|---|
| 总导演 | GPT-5.6 Luna | low | 0.25 | system-kernel + workflow |
| 市场策略师 | GPT-5.6 Terra | high | 0.30 | market-selection |
| 故事架构师 | Kimi K3 | max | 模型默认 | long-arc |
| 章节架构师 | GLM-5.3 Flash | 关 | 0.55 | chapter-planning |
| 人物与情感导演 | Kimi K3 | max | 模型默认 | natural-prose |
| 正文作者 | GLM-5.3 | 关 | 0.78 | chapter-writing |
| 硬逻辑审计员 | GPT-5.6 Terra | high | 0.10 | continuity-audit |
| 叙事编辑 | Kimi K3 | max | 模型默认 | surgical-revision |
| 状态管理员 | GLM-5.3 Flash | 关 | 0.10 | state-learning |
| 工具操作员 | DeepSeek V4 Flash | 关 | 0.05 | token-economy |
| 研究编辑 | DeepSeek V4 Pro | high | 模型默认 | evidence-research |

路由原则见 `NovelOS/00-control/model-routing.md`。正文作者不挂工具或 MCP，只接收闭合的最小 Chapter Packet，一章只生成一版。联网、考据和 MCP 都由总导演在出现真实缺口时临时启用。

## 默认工作模式

- `FAST`：普通章节。章节卡 → 一版正文 → 本地硬门 → 必要时一次局部修订。
- `STANDARD`：关键人物章、转折章或明确质量风险，加入对应专业 Agent。
- `DEEP`：立项、卷级转折、高潮、史实或专业高风险任务，只生成短方案分支，不并行写多份完整正文。

## 安全与隐私

仓库不包含 API Key、FeelFish 会话、积分账户、作者历史小说或平台后台数据。公开发布自己的衍生项目之前，请再次排除 `.feelfish/memory/`、备份目录、真实章节和平台导出数据。

## 许可

MIT License。你可以使用、修改和分发，但模型服务、FeelFish 及外部资料仍受各自条款约束。
