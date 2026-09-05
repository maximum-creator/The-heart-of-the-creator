# The Heart of the Creator / NovelOS

面向 FeelFish 的中文商业网文多智能体创作系统。它不是把 Agent、Skills 和 MCP 全部常驻，而是由主智能体按任务组建最小团队：市场、故事、人物、章节、正文、硬逻辑、叙事编辑、状态、研究与工具彼此分工，共享文件状态。

当前版本定位为可直接投入新书生产的公开版。默认面向番茄式移动阅读场景，重点控制慢节奏、模板化情绪、角色同声、连续性错误、重复句式、标点失衡、长段落和无效多模型返工。模型效果与平台价格会变化，公开路由是 2026-09 的生产快照，不代表永久排名，也不保证收益。

## 快速开始

完整安装与新书复用见 [安装指南](docs/INSTALL.md)。建议保留一份原始 ZIP，每本书解压一份作为独立项目；FeelFish 的资源导入不能代替完整目录安装。

1. 下载或克隆本仓库。
2. 在 Windows PowerShell 运行 `powershell -ExecutionPolicy Bypass -File .\scripts\initialize-novelos.ps1`。脚本会校验结构、同步模型路由并生成本地 MCP 配置，全程不会调用付费模型；只检查可使用 `-CheckOnly`。
3. 在 FeelFish 中把仓库根目录作为“小说项目”打开。
4. 选择自定义方案 `NovelOS 番茄超级写作者`，主智能体应为 `NovelOS 总导演`。
5. 新书先让总导演执行“立项”，填写 `NovelOS/01-market/reader-contract.md`；随后可以直接要求它完成总纲、前三章设计或单章生产。首次演练可参考 `examples/minimal-run/`。
6. 如需本地确定性工具，在 FeelFish 的 MCP/工具设置中添加初始化脚本生成的 `NovelOS/tools/mcp-server/mcp-config.local.json`。只把这组工具授予 `novelos-tool-operator`。

配置文件：

- 当前模型覆盖：`.feelfish/solution.json`
- 可导入方案：`.feelfish/solutions/feelfish-custom.json`
- 模型路由唯一来源：`NovelOS/00-control/capability-model-map.json`
- 11 个 Agent：`.feelfish/agents/`
- 16 个 Skills：`.feelfish/skills/`
- 小说工程状态：`NovelOS/`
- 八个受限 MCP 工具：`NovelOS/tools/mcp-server/`

## 生产模型路由

| Agent | 默认模型 | 思考 | 温度 | 静态 Skill |
|---|---|---:|---:|---|
| 总导演 | GPT-5.6 Luna | low | 不发送 | system-kernel + workflow |
| 市场策略师 | GPT-5.6 Terra | high | 不发送 | market-selection + reader-retention |
| 故事架构师 | Kimi K3 | max | 模型默认 | long-arc + creative-room |
| 章节架构师 | GLM-5.3 Flash | low* | 0.55 | chapter-planning |
| 人物与情感导演 | Kimi K3 | max | 模型默认 | natural-prose |
| 正文作者 | GLM-5.3 | low* | 0.78 | chapter-writing |
| 硬逻辑审计员 | GPT-5.6 Terra | high | 不发送 | continuity-audit |
| 叙事编辑 | Kimi K3 | max | 模型默认 | surgical-revision + cross-chapter-variation |
| 状态管理员 | GLM-5.3 Flash | low* | 0.10 | state-learning |
| 工具操作员 | DeepSeek V4 Flash | 关 | 0.05 | token-economy |
| 研究编辑 | DeepSeek V4 Pro | high | 模型默认 | evidence-research + craft-distillation |

路由原则见 `NovelOS/00-control/model-routing.md`。具体模型、思考档位和温度统一维护在 `NovelOS/00-control/capability-model-map.json`，修改后运行 `node NovelOS/tools/config/sync-model-routing.mjs --write` 投影到 FeelFish 配置。正文作者不挂工具或 MCP，只接收闭合的最小 Chapter Packet，一章只生成一版。联网、考据和 MCP 都由总导演在出现真实缺口时临时启用。

## 长篇状态与连续性

`NovelOS/04-canon/entity-state-ledger.json` 是人物位置与在场、物品归属、信息来源、金钱、伤病恢复和伏笔期限的机器事实源。`novelos_state_audit` 在写作前后执行确定性审计，`render-state-ledger.mjs` 再生成人可读视图。审计只标记需要复核的位置，不把句式、情感或所谓“人味”变成僵硬 KPI，也不会擅自改剧情。

## 默认工作模式

- `FAST`：普通章节。章节卡 → 一版正文 → 本地硬门 → 必要时一次局部修订。
- `STANDARD`：关键人物章、转折章或明确质量风险，加入对应专业 Agent。
- `DEEP`：立项、卷级转折、高潮、史实或专业高风险任务，只生成短方案分支，不并行写多份完整正文。

## 安全与隐私

仓库不包含 API Key、FeelFish 会话、积分账户、作者历史小说或平台后台数据。公开发布自己的衍生项目之前，请再次排除 `.feelfish/memory/`、备份目录、真实章节和平台导出数据。

## 许可

MIT License。你可以使用、修改和分发，但模型服务、FeelFish 及外部资料仍受各自条款约束。

## 参与开发

参见 [贡献指南](CONTRIBUTING.md)、[版本记录](CHANGELOG.md) 和 [最小示例](examples/minimal-run/README.md)。公开仓库提供无需模型密钥的回归测试；测试验证工程行为，不代表文本质量、收益或宿主 UI 已通过验收。

> 参数兼容性修正（2026-09-05）：GLM 的 low* 为配置目标，FeelFish 当前公共目录缺少专属档位映射，尚未证明请求实际发送 low；不可据此承诺低档成本。详见 NovelOS/00-control/model-parameter-compatibility.md。历史测试记录保留原样，不代表当前配置。
