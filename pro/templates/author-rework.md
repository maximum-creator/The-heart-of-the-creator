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

## 同一写作运行的后续返工

1. 用 `canon.mjs rework-save <vault> <本轮候选.json>` 把待审稿或失败稿留在同一 runId 下。第一版也可来自原先已暂存的候选。终稿未定时先归档，再登记独立复审报告。审核无法通过的版本依然可查看；越界、错版本或结构无效的补丁不会登记成候选稿。
2. 用 `canon.mjs rework-history <vault> <bookId> <runId> [候选哈希]` 或只读 MCP 查看版本链。指定哈希可看到该版全文、上一版正文、这轮改动及复审。再点段时从这一版的 final 取引文。新候选填 `parentCandidateSha256`，沿用同一章包、运行编号和逐字原稿。旧轮的问题继续留在终审，父轮的阻断项或待裁决项由后续报告 `priorBlockers` 逐条给 key、decision、quote 和 note。若改后稿的父轮尚无复审，先补父轮判断。
3. 回退时可以读取任一旧版继续返工，也可以重新选择有质量报告且无阻断项的旧版。用 `canon.mjs rework-select <vault> <选择记录.json>`，文件含 `bookId`、`runId`、`candidateSha256`、`authorRef` 和 `expectedEventSha256`，最后一项取版本目录的 `decisionHistoryHead.eventSha256`。如果你已经选过一版、看完又决定继续改，把 `candidateSha256` 写为 null 就能撤回该选择，旧凭据随即失效。
4. 终审通过后，用 `canon.mjs approve <vault> <bookId> <runId> <候选哈希> <作者记录> --selection=<本次selectionSha256>`。缺上游回执或有待裁决意见时再分别加现有人工确认开关。改选会产生新的选择凭据，同一候选重新选中也需要使用新凭据。批准发布中断后以相同凭据和确认信息重试；正式快照发布后，所有草稿与复审仍可读。
