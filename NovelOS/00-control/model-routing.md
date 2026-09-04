# NovelOS 生产模型路由

版本：2026-09 公开写作榜生产快照。榜单只用于岗位先验；真实章节质量、有效成稿成本和读者数据持续优先于模型名。

| Agent | 模型 | 参数 | 职责边界 |
|---|---|---|---|
| 总导演 | `feelfish/gpt-5.6-luna` | low / 0.25 | 高频分派、预算与收口，不写长正文 |
| 市场策略师 | `feelfish/gpt-5.6-terra` | high / 0.30 | 立项、读者契约、数据异常诊断 |
| 故事架构师 | `feelfish/kimi-k3` | max / 默认温度 | 总纲、卷纲、伏笔、高潮与回收 |
| 章节架构师 | `feelfish/GLM-5.3-flash` | thinking off / 0.55 | 高频生成闭合 Chapter Packet |
| 人物导演 | `feelfish/kimi-k3` | max / 默认温度 | 欲望、误解、关系博弈与情绪节拍 |
| 正文作者 | `feelfish/GLM-5.3` | thinking off / 0.78 | 默认日更正文，一章一版 |
| 硬逻辑审计 | `feelfish/gpt-5.6-terra` | high / 0.10 | Canon、知识边界、时间空间、专业事实 |
| 叙事编辑 | `feelfish/kimi-k3` | max / 默认温度 | 只修有证据的主要人物、情绪或节奏损失 |
| 状态管理员 | `feelfish/GLM-5.3-flash` | thinking off / 0.10 | 定稿后的结构化状态差量 |
| 工具操作员 | `feelfish/deepseek-v4-flash` | thinking off / 0.05 | 七个受限 MCP 工具与短结构化任务 |
| 研究编辑 | `feelfish/deepseek-v4-pro` | high / 默认温度 | 按需联网、史实、职业与时效事实 |

## 调用规则

1. 总导演只启动会改变当前决定的岗位，不固定串联全部 Agent。
2. 正文作者只挂 `novelos-chapter-writing`，无工具、无 MCP、无整本上下文，一章只生成一版。
3. Kimi K3 只处理高价值结构、关键人物和已有证据的局部修订，不做搬运或状态整理。
4. 研究编辑仅在最新市场、网络语境、史实或专业事实存在具体缺口时联网；事实压缩成卡后才进入写作层。
5. MCP 只挂给工具操作员；本地规则可以完成的检查不调用模型。
6. 不并行生成多份完整正文，不自动重试，不为“去 AI 味”整章洗稿。
7. 路由调整只由持续的门禁失败、返修成本或真实读者数据触发。
