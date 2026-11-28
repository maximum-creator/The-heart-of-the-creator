# 本机章节运行

本机先取证、编译、留存原稿并核对版本。导演、编辑和独立审稿人只收到各自需要判断的材料。工具结果可通过任务文件交回 FeelFish 会话。

在安装包根目录用 Node.js 22 运行。将参数文件和 vault 放在自己的本机私有目录。命令最后一项也可写 `-`，从标准输入接收 JSON。

```powershell
node NovelOS/tools/pro/run.mjs prepare "D:/NovelOS/private-canon" "D:/NovelOS/local-task/prepare.json"
node NovelOS/tools/pro/run.mjs capture "D:/NovelOS/private-canon" "D:/NovelOS/local-task/capture.json"
node NovelOS/tools/pro/run.mjs draft "D:/NovelOS/private-canon" "D:/NovelOS/local-task/draft.json"
node NovelOS/tools/pro/run.mjs audit "D:/NovelOS/private-canon" "D:/NovelOS/local-task/audit.json"
```

| 命令 | 交给本机的内容 | 返回 |
|---|---|---|
| `prepare` | `bookId`、新 `runId`、`plan`（`chapter`、`parentVersion`、`requiredFactKeys`、`risks`，可带 `activeThreads`、`sceneMode`）；再给从章务确认过的 `brief`、`dueDecisions`，需要时给 `castActions` 与 `preDraftRefs` | 没有定稿章务时先返回计划和 `planSha256`。需要前置判断时，返回待处理岗位。每份 `preDraftRefs[岗位ID]` 附 `planSha256`、`decision: PASS` 和实际审核记录的 `evidenceRef`。准备完成后返 `runSha256`、章包和调度单 |
| `capture` | `bookId`、`runId`、`runSha256`、逐字 `raw`，以及可取得的 `finishReason` 和 `finishEvidence` | 原稿留存和交付状态。截断保留原文并停在这里。实际服务方结束回执仍由本地 `canon.mjs receipt` 登记 |
| `draft` | `bookId`、`runId`、`runSha256`、`rawSha256`、候选 `changes`（无状态变化时用空数组） | 审阅用的 `draftSha256`、候选、版本证明。准备返工版时另外交 `editReceipt` 和编辑返回的 `replacement` |
| `audit` | `bookId`、`runId`、`runSha256`、`report`。以 `quality-review.example.json` 为底稿，报告携带本次的 `draftSha256` 和实际独立判断 | 保存已审候选，含 `candidateSha256`、质量状态和选择用的 `eventSha256`。判退的稿仍可续改和查看 |
| `rework-plan` | `bookId`、`runId`、`runSha256`、欲继续返工的 `candidateSha256` 和 [点段问题](author-rework.md) | 逐字锁定这版的目标，返 `editReceipt`。结构或正式设定问题退回相应岗位 |
| `status` | `bookId`、`runId` | 已保存的运行凭据、原稿哈希、待审稿哈希、候选版本和当前选择 |

首次准备可从 `chapter-plan.example.json` 取章务字段，从 `chapter-handoff.example.json` 取 `brief` 和 `dueDecisions`。稿件和设定核查材料留在本机。主笔只收返回的 `packet`，审稿交当次候选与它使用的证据。

中断后先用 `status` 找回已保存的凭据，或用相同输入重跑同一个步骤。原稿按 runId 只保存一次。章节基准改变时重新计划并使用新的 runId。晚到的正式结束回执使原先的审阅凭据失效，重新运行 `draft` 后再提交相符的报告。

用 `canon.mjs rework-history` 查看本次和上一版的逐字差异。回退就重新选某个质量合格的旧版本，草稿和失败版依然保留。最后按 [作者终审](author-rework.md#同一写作运行的后续返工) 执行明确的选稿和批准；自动运行入口停在 `AUTHOR_REVIEW_REQUIRED`。
