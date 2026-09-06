# 造物主之心 · NovelOS

**正式开源：把一支小说创作团队装进 FeelFish。11 个智能体，16 项专用技能，从故事构思到章节复核协作完成。**

The Heart of the Creator — an open-source, multi-agent Chinese novel-writing system for FeelFish.

[安装与复用](docs/INSTALL.md) · [市场版](marketplace/feelfish/README.md) · [上架与客服交付](docs/MARKETPLACE-HANDOFF.md) · [模型配置](NovelOS/00-control/model-routing.md) · [贡献指南](CONTRIBUTING.md) · [MIT 许可](LICENSE)

面向 FeelFish 的中文商业网文多智能体创作系统。它不是把 Agent、Skills 和 MCP 全部常驻，而是由主智能体按任务组建最小团队：市场、故事、人物、章节、正文、硬逻辑、叙事编辑、状态、研究与工具彼此分工，共享文件状态。

默认面向番茄式移动阅读场景，重点改善慢节奏、模板化情绪、角色同声、连续性错误、重复句式、标点失衡、长段落和无效多模型返工。它是一套可安装、可改造的创作工程，不是“自动写出爆款”的保证；模型效果与平台价格会变化，公开路由是 2026-09 的配置快照，不代表永久排名，也不保证收益。

## 为什么做这套系统

- **先让故事成立，再让文字动人。** 把人物动机、关系变化、冲突和伏笔放进创作过程，不只在最后替换几个“AI 词”。
- **按需组队，不让所有模型轮流重写。** 总导演分派具体任务，正文作者专注写作，研究与复核在需要时介入。
- **长篇需要记忆，也需要证据。** 完整版用共享状态和辅助程序检查部分可确定的问题；审美、情感与故事吸引力仍需要文本判断。
- **开源可改，不绑定一套永久模型名单。** 模型、参数、技能和程序都可查看与调整。欢迎提交真实失败样例、兼容性修复和创作经验，也欢迎点一个 Star。

## 先选对版本

市场版已把五份必要文档模板放入所属技能，按需读取，并为上下文管理员配置宿主 `get_file_info` 统计能力。无需为单纯字数统计安装脚本。详见 [系统评估与本次收敛](docs/SYSTEM-REVIEW.md)。

| 内容 | 本地完整版（仓库根目录） | 市场版（`marketplace/feelfish/`） |
| --- | --- | --- |
| 智能体与技能 | 11 个 / 16 项 | 11 个 / 16 项，自包含适配 |
| 模型分工与参数 | 提供配置，需自己的模型服务 | 提供配置，需自己的模型服务 |
| 辅助程序与 MCP | 包含源码，需 Node.js 与本机配置 | 不依赖自定义程序或 MCP |
| 复核方式 | 程序检查配合模型文本复核 | 模型根据实际文本复核 |
| 获取方式 | 下载仓库 ZIP，按安装指南配置 | 导入该子目录；市场上架仍需平台审核 |

市场版不是把完整版脚本删掉后继续承诺相同能力。仓库开源、文件齐全、MCP 连接、市场审核通过是不同的验证事项。

## 快速开始

**FeelFish 市场上架请使用独立的 [市场版目录](marketplace/feelfish/README.md)**。根目录是本地完整版，不应当作可由市场完整上传的资源包。市场版保留创作角色与技能，但不依赖外部脚本，也不提供完整版的机器验收能力。

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
