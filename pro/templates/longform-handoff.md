# 长篇交接模板

这份模板保存在每章试写记录。正文作者只收精简章包。正式稿与状态入库、真实模型回执使用 [运行回执与正式状态交接](acceptance-and-runtime.md)。

| 产物 | 填写内容 |
|---|---|
| 卷卡 | 目标读者、当前承诺、终点变化、主要兑现、还未回收的伏笔 |
| 基准 | bookId、卷号、章号、runId、上一已批准快照版本、原稿路径 |
| 场景交接 | 当前人物目标、主动阻力、可选行动、选择代价、章末可见变化、已批准事实来源 |
| 质量记录 | 原稿版本、停机原因、独立审读原句、下一步动作 |
| 修后审计 | 精修稿版本、原来和改后的人物选择、知识、物品、时间与结尾变化；PASS／OPEN／HARD_FAIL |
| 状态提案 | 逐项记录旧值、新值、正史来源、稿件证据、候选状态 |
| 作者批准 | 指定稿件版本、范围、回执，下一章可见的有效快照 |

## 两章离线应验例

- 第一章原文说「宋枝只同意把借来的钥匙还回去」。候选精修改成「宋枝当面把铺子交了出去」。即使替换范围合法，修后审计仍应返工。正式快照只记录归还钥匙的承诺，下一章不能把铺子的归属当作已经变更。
- 第一章只有宋枝听伙计说锁坏了。来领鞋的客人只看见提前收摊。第二章如果客人知道锁坏了，需要在正文里交代他从哪里听说或如何看见。

## 调度和证据

本机直调 `novelos_pro_plan_chapter`，传 `bookId`、下一章 `chapter`、批准的 `parentVersion`、最多十个 `requiredFactKeys` 和 `risks`。风险从卷纲与作者任务判定。可用 `node NovelOS/tools/pro/mcp.mjs call novelos_pro_plan_chapter <参数.json>` 运行。

可带最多十个 `activeThreads`。返回的 `suggestedEvidence` 包含活跃线和已到期的开放承诺，按兑现章排序。查看 `dueCount` 和 `omittedSuggestions`，有取证遗漏时缩小到故事线或点名所需事实。到期项进入关键章路径，导演决定本章兑现、延后或请求作者裁决。

- `creative_difficulty` 增加 Opus，`viewpoint_change`、`relationship_turn`、`foreshadow_payoff` 或 `timeline_jump` 进入关键章路径。
- `volume_end`、`cross_chapter_replan` 或 `unresolved_conflict` 触发 Astra 复核。等导演处理复核未决项后再交 Carbon。
- `sample_review` 增加 Sonnet 独立盲读。作者批准后再走下一章，MCP 返回的前章尾段按原样传入 `previousTail`。

`READY_FOR_HANDOFF` 表示基准匹配、请求的事实齐全并已产出调度单。它允许导演按序执行，前置复核的结论仍需记录。`STALE_BASELINE` 或 `MISSING_EVIDENCE` 时停在取证。核对事实应回到结果中的章节、引句和稿件哈希。

群像章把调度单标为 `sceneMode: ENSEMBLE`，在 prepare 实参顶层附 `castActions`，不要写进 `brief`。每条填写 `character`、`goal`、`leverage`、`knowledgeBoundary`、`action`、`affects` 和 `consequence`；`affects` 是受影响的另一位在场人物。可用 `knownFactKeys` 绑定本角色实际可用的已批准事实。私人知情键用 `knowledge:角色.事项`，并列入本章请求事实。从旧稿或大纲得出的场景边界留在 `knowledgeBoundary`，不凭这条描述更新正式事实。普通章不带行动表，启用群像数据不会自动增加岗位调用。

等前置复核完成，再用 `novelos_pro_prepare_chapter` 提交章务 `brief`、`factKeys` 和完整 `dueDecisions`。每条到期项填 `key`、`action`、`reason`。兑现选择 `PAYOFF` 并把对应事实列入 `factKeys`，延期选择 `DEFER` 并提供将来的 `dueChapter`。需要作者裁决时填写 `AUTHOR_REVIEW`，留在筹备阶段。章务的 `designConstraints` 用于记录本章设计，MCP 从批准快照单独生成 `hardFacts` 和上章尾段。主笔只收工具返回的 `packet`。

## 拟修旧章

先向证据工具提交 `sourceChapter`、该批准稿的 `sourceFinalSha256`、当前 `headVersion`、变动的 `changedFactKeys`，以及 `proposedFinal` 或 `previousTailChanged`。有拟改稿时工具会计算其哈希并核对尾段。报告返回关联的批准章和当前基准上的已暂存候选。

- `REVIEW_DIRECT_DEPENDENCIES` 核查本章正式登记的事实或相邻原文尾段。
- `REVIEW_INDIRECT_DEPENDENCIES` 沿报告给出的中间章追查后续产出的事实。列表是保守的复核范围。
- `REVIEW_UNTRACKED` 逐份查看旧版遗留记录。
- `REVALIDATE_BASELINE` 核对后续承接是否仍成立。

先由 Sol 对照作者拟改内容和工具报告审计。只有波及卷线、需要跨章重排或留下未解决的跨章硬冲突时，才加 Astra 独立复核；实际重审范围由作者确认。未暂存的工作稿不在报告范围内。报告是只读预览。

## 作者终审

开卷先确认读者在等什么、关键人物的声线样张与本卷应兑现的代价。卷中、卷末和下卷开头连读，定位想跳读的首处、重复场面的相同结果、人物越权知情以及承诺是否兑现。审读意见保留段落位置、逐字引句、阅读损失和建议处理范围。局部问题随终稿差异交终审。整段因果失效时退回卷纲。

作者本地 `review` 可查看原稿、终稿、局部修改理由、状态变更、交付状态和待批准哈希。读者意见与审计原件保存在本地项目记录。正式批准使用终审确认的哈希。
