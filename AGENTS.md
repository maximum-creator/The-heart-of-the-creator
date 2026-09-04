# NovelOS 创作系统协作约定

本项目采用“共享黑板 + 专业智能体”协作。所有智能体先读任务信封中列出的文件，不把整本小说或全部历史复制进消息。

## 信息等级

- `HARD`：已批准 Canon、明确事实、平台硬规则。冲突时必须停止并报告。
- `SOFT`：大纲、节奏建议、市场判断、创作假设。允许有理由地偏离。
- `OPEN`：尚未决定的创作空间。优先探索，不提前封死。

审美建议不能伪装成硬规则。突破常规若带来更强人物因果、情绪体验或阅读动力，可以保留；只需记录它改变了什么。

## 协作协议

1. 主智能体用 `call_sub_agent` 分派任务；已有内容只传项目相对路径，不粘贴全文。
2. 每次委派必须说明：目标、模式、读取文件、允许写入、预算级别、验收条件和禁止改动。
3. 同一专业任务优先使用 `continueSessionId` 延续子会话，避免重复发送背景。
4. 每份产物只有一个负责人；其他智能体只提交意见或差量，不能暗中重写同一文件。
5. 发散阶段不使用审稿规则压制创意；收敛阶段才检查事实、Canon、因果和商业目标。
6. CALIBRATION 阶段未经用户批准的草稿不得进入正式 Canon；PILOT/PRODUCTION 阶段只有带完整哈希、成本、硬检、审稿和回滚证据的自动验收稿可以提交，模型自述不能代替回执。
7. 只读够完成当前任务的最小上下文；需要扩大读取范围时先说明理由。
8. NovelOS MCP 采用工具舱隔离：只有 `novelos-tool-operator` 挂载；其他 Agent 不得配置 `tools: all`。
9. 正文由 `novelos-prose-writer` 直接生成：只加载 `novelos-chapter-writing`，不挂工具或 MCP，一章一会话且只生成一版；失败不得自动重试或并行换模型。
10. 运行前读取 `NovelOS/00-control/capability-switchboard.md`。不固定串联全部 Agent；正文的叙述与情感必须在人物发动机和场景因果中产生，不能在末端用辞藻润色补造。

## 默认产物路径

- 系统状态：`NovelOS/00-system/`
- 市场与读者：`NovelOS/01-market/`
- 故事设计：`NovelOS/02-story/`
- 人物与情感：`NovelOS/03-characters/`
- 正式事实：`NovelOS/04-canon/`
- 当前章节：`NovelOS/05-chapter/`
- 正文输入协议：`NovelOS/05-chapter/current-chapter-packet.md` 与 `current-context-manifest.md`
- 学习与实验：`NovelOS/06-learning/`
- 研究证据：`NovelOS/07-research/`
- 数据与成本：`NovelOS/08-analytics/`
- 回归评测：`NovelOS/09-evals/`
