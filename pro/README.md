# NovelOS Pro 1.6.0 · 长篇连载方案

独立于 NovelOS 标准版的 FeelFish 方案。Carbon 一章一稿，Opus 按需辅助，Sol 负责导演与常规审计，Astra 复核卷级冲突。作者本地批准正式设定。

## 导入 FeelFish

1. 从仓库根目录运行 `node scripts/build-novelos-pro.mjs <新目录>`，导入生成的 `feelfish.json`。选择自定义方案，确认总导演和十个岗位。
2. 在模型菜单核对 Carbon、Opus 5.5、Sol、Astra 的可用性。Sonnet 三个岗位使用同一个自定义接口 `novelos-pro-openrouter`（OpenRouter 的 OpenAI 兼容地址和模型名 `anthropic/claude-sonnet-5.5`）。
3. 用包内 `mcp-config.template.json` 添加本地 stdio 服务，填项目绝对路径和已有的私有 Canon vault 路径。服务进程通过 `NOVELOS_PRO_VAULT` 读取批准快照。七个 Pro 工具只给工具管理员。

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

## 从卷纲到下一章

- FAST 复用批准卷卡，按需取证，Carbon 单稿，Sol 审计。前三章和抽检章加 Sonnet 盲读。
- STANDARD 在关系转折、换视角、时间跳跃或伏笔兑现时加场景架构和独立盲读。人物选择难写时由 Opus 提供方案。
- DEEP 在卷末、跨章重排或未决冲突时交 Astra 独立复核。导演处理未决问题再交主笔。

MCP 只读取授权 vault 里最新批准的快照，按事实键返回值、来源章节、原文引句和稿件哈希。缺事实或基准版本漂移时停止写手交接。跨章风险由导演从卷纲中提取，调度工具负责按规则分流。实际分派由宿主执行。

已批准的承诺和伏笔可登记故事线与预计兑现章。工具提示活跃线和到期事项，到期触发关键章路径。修改已批准旧章前，先预览需重审的直接依赖、未登记依赖和后续基准。影响预览保留已批准记录，实际改稿和重新审批由作者决定。

导演处理到期伏笔后，由 MCP 直接从快照编译开写章包。实际捕获的回执通过本地 CLI 登记，与章包及原稿核对。编辑后重验最终稿，提交有逐字依据的连续性报告，关键章加独立读感。作者用本地 review 查看原稿、差异、状态提案、报告和待裁决意见。详细操作见 [长篇交接](templates/longform-handoff.md) 和 [回执与正式状态](templates/acceptance-and-runtime.md)。

本版验收覆盖离线打包、逐岗配置、只读取证、跨章调度和批准流程，还有 24 章卷线及下一卷候选的合成夹具回归。账户可用性、FeelFish 实际调度、真实整卷质量和上游参数待实测。
