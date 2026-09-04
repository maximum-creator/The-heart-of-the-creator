# 局部修订单

- `blindReviewReceiptSha256`：锁定审稿回执的 SHA-256；不匹配当前候选时停止
- `anonymousCandidateId`：只写匿名候选编号，不写模型名和价格
- `mainLoss`：本轮唯一主损失；为 `NONE` 时不启动修订
- `concernEvidence`：对应主损失的正文原句、影响和维度判断
- `targetRanges`：允许修改的原文段落或行范围
- `frozenRanges`：明确冻结的正文；未列入 `targetRanges` 的内容默认也冻结
- `preservedFacts`：必须保留的事实、伏笔、人物决定、结果和声线特征
- `changeBudget`：最多修改多少处；默认一次局部修订，不得扩成全章洗稿
- `forbiddenAdditions`：禁止新增的 Canon、专业事实、能力、关系和解决机制
- `transitionNeeds`：目标片段与前后文必须维持的因果和语气衔接
- `postRevisionChecks`：修改后必须复查的事实、视角、人物能动性、因果和重复模式

修订完成后逐项回填实际改动范围。任何改动超出 `targetRanges`、违反 `frozenRanges`、无法由 `concernEvidence` 解释，或改变 `preservedFacts`，整张修订单判为无效并退回，不得继续追加润色轮次。
