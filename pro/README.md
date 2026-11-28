# NovelOS Pro 1.11.0 · 长篇连载与剧本方案

独立于 NovelOS 标准版的 FeelFish 方案。Carbon 一章一稿，Opus 按需辅助，Sol 负责导演与常规审计，Astra 复核卷级冲突。作者本地批准正式设定。

## 导入 FeelFish

1. 从仓库根目录运行 `node scripts/build-novelos-pro.mjs <新目录>`，导入生成的 `feelfish.json`。选择自定义方案，确认总导演和十个岗位。
2. 在模型菜单核对 Carbon、Opus 5.5、Sol、Astra 的可用性。Sonnet 三个岗位使用同一个自定义接口 `novelos-pro-openrouter`（OpenRouter 的 OpenAI 兼容地址和模型名 `anthropic/claude-sonnet-5.5`）。
3. 用包内 `mcp-config.template.json` 添加本地 stdio 服务，使用 Node.js 22，填项目绝对路径和已有的私有 Canon vault 路径。服务进程通过 `NOVELOS_PRO_VAULT` 读取批准快照。十一个 Pro 工具只给工具管理员。从市场应用方案后，同样需要单独配置本地 MCP。

FeelFish 导入文件给出目标模型和默认思考档。安装后需用脱敏回执核对实际模型、档位和输出预算。Sol/Astra 还需确认实际工具调用，尤其是 Sol 的子智能体分派。OpenAI 直连的原生工具调用使用 Responses API。

官方文档见 [FeelFish 自定义方案](https://www.feelfish.com/zh/docs/custom-agent-solution)、[自定义模型](https://www.feelfish.com/zh/docs/custom-model)、[Gemini 4 Carbon](https://aistudio.google.com/docs/models/gemini-4-carbon) 和 [OpenAI API 更新记录](https://developers.openai.com/api/docs/changelog)。

## 十个岗位

| 岗位 | 模型 | 默认思考目标 | 建议输出预算 |
|---|---|---|---:|
| 总导演 | GPT-6.2 Sol | Medium，卷级用 High | 4,096 |
| 正文主笔 | Gemini 4 Carbon | Medium | 12,288 |
| 创作辅助 | Claude Opus 5.5 | Medium | 4,096 |
| 场景架构 | Claude Sonnet 5.5 | Medium | 4,096 |
| 独立读者 | Claude Sonnet 5.5 | Medium | 4,096 |
| 局部编辑 | Claude Sonnet 5.5 | Low | 4,096 |
| 连续性审计 | GPT-6.2 Sol | Medium，关键章用 High | 4,096 |
| 卷级复核 | GPT-6.2 Astra | High | 6,144 |
| 书稿与状态管理员 | Gemini 3.8 Flash | Low | 3,072 |
| 工具管理员 | MCP 执行，Gemini 3.8 Flash 转交异常 | Low | 2,048 |

默认省略温度和其他采样参数。预算与思考档是运行目标，不同模式以路由表和实际上游回执为准。

## 模型参数与技能分配

| 模型 | 厂商规则 | 本方案使用方式 |
|---|---|---|
| Gemini 4 Carbon、Gemini 3.8 Flash | 用思考等级。Carbon 忽略采样参数，Flash 迁移指南要求移除 | Carbon Medium，Flash Low |
| Claude Opus 5.5、Claude Sonnet 5.5 | 常规调用使用自适应思考和 effort，省略 temperature、top_p、top_k | Opus Medium，Sonnet 架构和独立读者 Medium、局修 Low |
| GPT-6.2 Sol、GPT-6.2 Astra | 省略 temperature、top_p；OpenAI 原生工具调用使用 Responses API | Sol 日常 Medium、难章 High，Astra High |

FeelFish 通用控件不能证明某个模型支持调温或上游收到了指定思考档。对本方案的五类路由一律省略温度。生成配置中的思考档是目标，不能取得真实回执时保持待核验。

10 个技能都在岗位上有明确调用点。总导演使用调度和卷规划，Astra 使用卷规划和连续性，其余岗位各一项。Carbon、Opus、Sonnet 读者和编辑，以及工具管理员无需文件读取权限，其唯一技能由打包脚本内嵌。长程规则参考 [FeelFish 技能指南](https://www.feelfish.com/zh/docs/build-skills-for-novel)，会话深度参考 [Google 思考档位](https://aistudio.google.com/docs/thinking)、[Anthropic Opus](https://platform.claude.com/docs/en/models/opus-5-5/migration-guide)、[Anthropic Sonnet](https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide) 和 [OpenAI GPT-6.2](https://developers.openai.com/api/docs/guides/latest-model)。

## 从卷纲到下一章

网文、竖屏短剧、长剧和漫剧可共用故事线，按各自媒体条件调度和验收。小说继续用批准章包及正式设定流程，剧本走分集、场次或分镜检查。交付可用本地 MCP 或 CLI 预检，正式终审使用真实读者反馈、桌读或分镜复核。参见 [作品立项与交付验收](templates/work-readiness.md)。

卷前立项可按平台、读者、作品阶段、日期和样本筛分进门及追读证据。群像章节可把二至五位关键人物的筹码、知情范围、行动和后果写进已核准章包。普通章沿用短章包，沿用既有岗位与 Skills。参见 [立项判断](templates/work-readiness.md) 和 [群像交接](templates/longform-handoff.md)。

作者可以在同一写作运行的任一已存改稿上再点段，保留各轮前后差异、失败稿和复审。整场或跨章问题先返到对应岗位。终审选择以候选哈希和当前选择凭据为准。参见 [作者点段返工](templates/author-rework.md)。

- FAST 复用批准卷卡，按需取证，Carbon 单稿，Sol 审计。前三章和抽检章加 Sonnet 盲读。
- STANDARD 在关系转折、换视角、时间跳跃或伏笔兑现时加场景架构和独立盲读。人物选择难写时由 Opus 提供方案。
- DEEP 在卷末、跨章重排或未决冲突时交 Astra 独立复核。导演处理未决问题再交主笔。

MCP 只读取授权 vault 里最新批准的快照，按事实键返回值、来源章节、原文引句和稿件哈希。缺事实或基准版本漂移时停止写手交接。跨章风险由导演从卷纲中提取，调度工具负责按规则分流。实际分派由宿主执行。

已批准的承诺和伏笔可登记故事线与预计兑现章。工具提示活跃线和到期事项，到期触发关键章路径。修改已批准旧章前，先预览需重审的直接依赖、未登记依赖和后续基准。影响预览保留已批准记录，实际改稿和重新审批由作者决定。

导演处理到期伏笔后，由 MCP 直接从快照编译开写章包。实际捕获的回执通过本地 CLI 登记，与章包及原稿核对。编辑后重验最终稿，提交有逐字依据的连续性报告，关键章加独立读感。作者用本地 review 查看原稿、差异、状态提案、报告和待裁决意见。详细操作见 [长篇交接](templates/longform-handoff.md) 和 [回执与正式状态](templates/acceptance-and-runtime.md)。

本版验收覆盖离线打包、逐岗配置、只读取证、跨章调度和批准流程，还有 24 章卷线及下一卷候选的合成夹具回归。账户可用性、FeelFish 实际调度、真实整卷质量和上游参数待实测。
