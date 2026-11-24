# NovelOS Pro 1.2.0 · 长篇连载方案

这是一套 FeelFish 智能体和 Skills 配置。默认走单写手、按需复核的路线，适合中文长篇网文。包独立于 NovelOS 标准版，现有书稿可继续用原配置。当前版本只做离线安装包、配置和工具验证。

## 配置 FeelFish

1. 解压到新目录。在 FeelFish 项目中心导入含 `feelfish.json` 的目录。选择自定义方案，确认主智能体为「NovelOS Pro 总导演」及九个岗位。
2. 配置 Sonnet 5.5 的自定义接口 ID `novelos-pro-openrouter`，OpenAI 兼容地址为 `https://openrouter.ai/api/v1`，模型名 `anthropic/claude-sonnet-5.5`。使用你已有的密钥。其余路线先核对客户端模型菜单和账户权限。模型源由 `model-routes.json` 记录。
3. 可按 `mcp-config.template.json` 配置本地 stdio 服务，命令为 `node`、参数为包内 `NovelOS/tools/pro/mcp.mjs` 的绝对路径。四项工具只给 Pro 工具管理员。技能清单与正文代理随包安装。

官方入口：[FeelFish 方案](https://www.feelfish.com/zh/docs/custom-agent-solution) · [自定义模型](https://www.feelfish.com/zh/docs/custom-model)

## 九个岗位的模型配置

| 岗位 | 模型 | 思考目标 | 温度 | 建议总输出 Token |
|---|---|---|---|---|
| 总导演 | GPT‑5.6 Terra | FAST Medium，STANDARD / DEEP 建议 High | 省略 | 4,096 |
| 场景架构 | Claude Sonnet 5.5 | Adaptive Medium | 省略 | 4,096 |
| 主正文作者 | Claude Opus 5.5 | Adaptive Medium | 省略 | 12,288 |
| 备选正文作者 | Gemini 3.8 Flash | Low | 服务商默认 | 8,192 |
| 独立读者 | Gemini 3.8 Flash | Medium | 服务商默认 | 4,096 |
| 定点编辑 | Claude Sonnet 5.5 | Adaptive Low | 省略 | 4,096 |
| 连续性审计员 | GPT‑5.6 Terra | High | 省略 | 4,096 |
| 书稿与状态管理员 | Gemini 3.8 Flash | Low | 服务商默认 | 3,072 |
| 工具管理员 | Gemini 3.8 Flash | Low | 服务商默认 | 2,048 |

预算是建议值，实际输出上限及思考档位传输要看宿主。两条 Claude 路线省略温度与其他采样参数。无音色、风格对照时保留建议基线，不为压低 AI 味盲调采样参数。

厂商参数：[Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/migration-guide) · [Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/overview) · [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)

## 长篇工作模式

- **普通章 FAST**：复用有效卷卡与批准快照，整理一张短章包，Opus 一稿，查本章事实和交付。首三章、关键节点和有异议的稿件单独审读。稳定章可以成批确认，仍要逐章把批准绑定到具体版本。
- **关键章 STANDARD**：换视角、回收伏笔或人物关系转折才增加场景架构和独立审计。审读提出一个主要阅读损失。只修局部时做一次替换，修后重查剧情结果。
- **立项或卷级 DEEP**：才打开卷级结构、市场和读者反馈 Skills。短方案比较后锁定一条故事线。整卷只锁定必要兑现与长期方向，近三到五章写细节。

所有写手只读必要输入。Gemini 作为备选时独立写这一章，交 Sonnet 新会话匿名审读。Sonnet 后续编辑另开会话，连续性仍由审计员复核。与旧稿比较只在显式试验阶段进行。具体工作产物和两个离线反例见 [长篇交接模板](templates/longform-handoff.md)。

## 运行回执和批准入库

先记录真实请求和响应的脱敏字段，核对模型、实际档位、输出预算、Token、结束原因和费用。没有上游回执时仍属待核验。完成独立审核后才由作者批准当前候选。第二章通过批准后的快照取必要事实，草稿保存在另一个目录。

[运行回执、正式状态命令与六组试稿计划](templates/acceptance-and-runtime.md)

## 到底能验什么

- 11 项 Skills 把立项、卷规划、紧凑章包、正文、读感审稿、定点修订、连续性、状态和作者偏好落到具体岗位。
- 现有四项 MCP 工具检查章包结构、输出完整性、逐字引文及实际替换范围。其成功回执只覆盖工具做过的检查。系统要求独立审计员检查修后剧情和知识状态，作为定稿条件。
- 状态管理员准备候选记录；仅作者可用本地命令批准。保存、审计、审批和正式快照绑定同一书稿与状态版本，旧审批和并发覆盖由本地工具拒绝。
- 在未进行真实写作时，可以离线检查导入文件、岗位分派、Skills 绑定和 MCP 协议。FeelFish 实际调度、模型质量、参数转发和长篇质量仍待验证。
