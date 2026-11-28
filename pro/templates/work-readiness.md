# 作品立项与交付验收

先用同一份 `story` 把故事线讲清楚，再为每种载体提交一份 `unit`。工具返回相同的故事线哈希、各载体自己的工作单哈希，以及由哪些现有岗位处理。它可以通过本地 MCP 的 `novelos_pro_evaluate_work` 调用，也可以用 CLI 读本地文件：

```powershell
node NovelOS/tools/pro/work-readiness.mjs <评估文件.json>
node NovelOS/tools/pro/work-readiness.mjs <终审文件.json> <本地成稿.txt>
```

包内 `templates/work-readiness.example.json` 可直接跑立项检查。示例故事和门槛用于演示。

## 立项

定位可以先于完整卷纲。调用 `novelos_pro_evaluate_work` 传 `phase: POSITIONING`、`format` 和 `story.audience`、`story.positioning` 即可。包内 `templates/positioning.example.json` 可用同一 CLI 运行。

定位只需要进门承诺 `clickPromise`、追读理由 `reasonToReturn`、题材辨识度 `differentiator`、首次兑现 `firstPayoff` 和试读验证点 `testSignal`。另填作品阶段 `stage`、观察截点 `asOf`（YYYY-MM-DD）以及本项目自定的 `maxAgeDays` 和 `minSampleSize`。可比较记录填 `platform`、`segment`、`stage`、`observedOn`、`sampleSize`、`signal`（DISCOVERY 或 CONTINUATION）和 `direction`（FAVORABLE、UNFAVORABLE 或 MIXED）。

平台、读者或阶段不匹配，日期过旧、未来或无效，样本不足，都会分别提示。榜单、同类作品和创作猜测可保留为背景。只有进门证据时，追读仍是待验证。两种信号都覆盖时也保留各自方向，工具报告证据范围，记录是否真实及作品能否起量由后续实际反馈判断。

`story` 包含 `workId`、`premise`、`continuationEngine`、`audience` 和按顺序排列的四段 `beats`。读者资料填 `platform`、`segment`、`promise`。证据列表逐条填 `kind`、`source`、`observation`。同类作品为 `COMPARABLE`，未验证判断为 `HYPOTHESIS`，实际平台资料和目标人群访谈分别为 `PLATFORM_DATA`、`TARGET_INTERVIEW`。

四段依次为 `SETUP`、`CHOICE`、`PAYOFF`、`HANDOFF`。每段给递增的 `position`、`sourceRef` 和可观察的 `change`；从第二段起用 `because` 说明前一段怎样造成下一段。选择段同时给 `choice` 与 `cost`，承接段给 `openQuestion`。已有文本和计划中的章节都可引用，标明各自来源。缺完整卷纲时保留缺项。

## 四种工作单

每个 `unit` 给 `id`、`objective`、`change`、`risks`。风险取 `creative_difficulty`、`cross_unit_conflict`、`payoff`、`sample_review`、`scene_design`。第一次适配剧本或需要重新拆场时用 `scene_design`，已有场次计划的常规工作可沿用。剧本三类另注明 `productionLimit`，竖屏集给 `maxSeconds`。开工前在 `unit.acceptance` 记录 `minParticipants`、`minContinueRate` 和 `maxReworkMinutes`。阈值属于工作单版本，事后调整需重新评估。工具只形成调度单；派发用 FeelFish 总导演，章包、逐字稿、局部修订与 Canon 继续用原有工具。

| format | 验收焦点 | 真实反馈 |
|---|---|---|
| `NOVEL` | 人物声线、因果推进、读者承诺兑现、跨章一致 | 目标读者试读或对应分段数据 |
| `VERTICAL_DRAMA` | 可见行动、单集兑现、对白可演、单集时长与制作 | 目标观众反馈及桌读 |
| `LONG_DRAMA` | 可见行动、场次变化、主支线承接和制作 | 目标观众反馈及桌读 |
| `COMIC_DRAMA` | 画面可读、分镜推进、画面声线分工和资产 | 目标观众反馈及分镜复核 |

总导演和主笔各一位。创作困难启用 Opus；媒介结构需要拆场时交 Sonnet；跨集或跨场组的硬冲突需重排时交 Astra。完成草案后，连续性和状态整理都有负责人，按风险加入独立读稿与局修。每项工作单的 `dispatch` 列出实际岗位 ID，`tools: LOCAL_MCP` 表示该步骤由本机直调执行。不同载体共享故事计划，成稿和评审分别绑定自己的版本。

## 终审

把本地成稿作为第二个 CLI 参数，或通过 MCP 的 `artifact` 字段传当前审查片段。CLI 和 MCP 都只输出哈希和结构化结论。先用立项返回的 `workPlanSha256`，并按成稿实际文本的 UTF-8 内容取 `artifactSha256`。二者写入 `review`。按返回的 `reviewChecks` 逐项提交 `id`、`decision`（PASS、AUTHOR_REVIEW 或 BLOCK）、成稿的实际 `quote` 和 `note`。对于剧本，再填 `scenes`，每场填写唯一 `id`、`place`、`time`、实际稿里的 `actionQuote`、`estimatedSeconds` 和 `assets`。这些记录用于检查版本与制作条件。

离线数据标 `OFFLINE_FIXTURE`。正式评审标 `LIVE_REVIEW`，附目标人群反馈、制作证据和作者改稿时间：

```json
{
  "audience": { "kind": "TARGET_VIEWERS", "sourceRef": "实际反馈记录", "participants": 8, "wantContinue": 6 },
  "production": { "kind": "TABLE_READ", "sourceRef": "实际桌读记录", "decision": "PASS", "note": "记录发现" },
  "authorReworkMinutes": 45
}
```

示例数字用于说明字段。小说用 `TARGET_READERS`，无需制作复核；漫剧用 `STORYBOARD_REVIEW`。真实受众、数据来源和桌读情况由操作者如实登记。工具核对来源引用、成稿及评审版本，参照项目设定的门槛核对实际反馈。分别显示资料不足、返工、离线通过和待作者审阅。你确认开放意见后，以 `author: { "decision": "APPROVE", "sourceRef": "本次终审记录", "reviewSha256": "工具返回值", "notesReviewed": true }` 记录终审。该工具只读，不会发布成稿或改写正式设定。

收集反馈时可参考 [番茄小说阅读数据说明](https://fanqienovel.com/writer/zone/article/7603060375050797081) 和 [长故事分层大纲研究](https://aclanthology.org/2023.acl-long.190/)。项目阈值由作者结合题材、平台和作品阶段设定。
