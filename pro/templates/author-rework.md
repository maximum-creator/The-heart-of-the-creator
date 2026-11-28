# 作者点段返工

接到「第几段 AI 味重、表达太直或重复」时，保留作者原话与当前稿版本。选中原句或给准确的起止行。导演让编辑提出具体诊断，工具管理员按诊断和范围锁定返工单。一次从同一原稿锁定一至五个互不重叠的片段。

| 作者反馈 | 先判断 | 候选修改 |
|---|---|---|
| AI 味重 | 角色是不是在说所有人都能说的话，句式是否反复，旁白是否替读者解释已经看到的结果 | 删掉重复补释，从角色的处境、说话对象和眼前利益切入 |
| 直给 | 这是读者必须知道的期限与规则，还是已经通过情境读出来的情绪和动机 | 明确信息保留；情绪按角色会做、会避开、会说漏的细节处理 |
| 冗余 | 这段是否新增信息、后果、关系变化或必要的节奏停顿 | 保留独有内容，再压缩或删除重复处 |

先写清读者损失、可验证的原因、准备采取的手法和必须保留的内容。段落表达用 `SURFACE`。整场冲突或选择失效用 `SCENE`，退回场景架构。涉及正式设定、许诺、知情范围和跨章回收用 `CANON`，先做连续性与影响核对。分类由岗位提出并附依据，工具负责锁定版本、范围及分流。

## 工具交接

1. `novelos_pro_plan_rework` 接收 `prose`、`proseSha256`、`issues`。每项有 `target`（唯一 `quote`，或从 1 开始的 `firstLine` 和 `lastLine`）、`authorNote`、`categories`（AI_VOICE、DIRECT_EXPOSITION、REDUNDANCY）、`impact`、`diagnosis`、`preserve` 列表、`strategy`。重叠片段合并判断，位置不明确时停在定位。
2. `novelos_pro_apply_edit` 接收同一 `prose`、工具返回的 `order`，以及 `replacement: { editorRef, patches: [{ id, text }] }`。空字符串表示删除。原稿其余字符由工具原样拼回。工具返回逐项差异、修改稿和 `reworkSha256`。
3. `novelos_pro_check_rework` 接收上一步的输入和 `report: { reviewer, reworkSha256, findings }`。每项 finding 带 `id`、`decision`、`quote`、`result` 和 `preservation: [{ constraint, decision, note }]`。删除的 `quote` 用 null；复审说明删后保留了什么。判定为 PASS、AUTHOR_REVIEW 或 BLOCK。复审员与编辑分开，保护项逐条评估。
4. 小说候选的 `edit` 保存准确的 `order` 和 `replacement`，`quality.rework` 所用的输入交报告的 `rework` 字段。终审显示原话、原因、保护项和前后差异；阻断项暂停暂存，争议由作者确认。剧本把修后稿交回对应作品验收，沿用旧稿哈希会失效。

用 `node NovelOS/tools/pro/rework.mjs plan|apply|check|rollback <input.json>` 可以离线运行。回退输入为 `{ revised, receipt }`，`receipt` 用原样的 apply 回执。只有当前改稿和回执的哈希一致，才会返回逐字原稿。工具不落盘、不覆盖作者稿。已批准旧章要通过旧章影响预览和正式审批；回退草稿不会更改已批准设定。
