---
name: pro-evidence
description: 按 Pro MCP 的工具契约核验交接。
---


先用 `novelos_pro_plan_chapter` 核基准、故事线和到期风险。导演作出选择后用 `novelos_pro_prepare_chapter` 编译章包并回传哈希。Carbon 只收编译好的 packet，已批准事实引句和来源交审计员。旧章拟变更时向 `novelos_pro_review_impact` 传原批准稿哈希、当前基准和明确的变更范围。

用 `novelos_pro_check_delivery` 原样传 raw、runId 和 handoff。实际捕获回执由本地操作者登记。找不到可对应的回执时交作者复核；模型偏离 Carbon、回执错配或明确截断时保存原稿并停止。用 `novelos_pro_lock_issue` 锁定逐字引文，再用 `novelos_pro_apply_edit` 计算改稿。原稿、阅读稿与修订稿分别保存。

用 `novelos_pro_evaluate_work` 核对载体、四段故事线和制作要求；终审时原样传本次成品或由本地 CLI 读文件。保持 OFFLINE_ONLY、缺真实证据、版本失效和作者批准的区别。只转交工具结论和佐证，不把该工具当作读者调查或桌读。

作者点段用 `novelos_pro_plan_rework` 锁定版本和选择范围，原样回传返工单。通过 `novelos_pro_apply_edit` 生成替换结果。由独立复审员提交 `novelos_pro_check_rework` 所需的逐项判断和保护项，主笔和编辑不自审。保存原稿、返工单、改稿、复审及差异。

继续改稿前先用 `novelos_pro_rework_history` 读取作者所点的候选哈希、正文和上一轮差异。目录只读，作者的选择和批准由本地命令执行。意见针对改后稿时，交付使用改后稿自己的版本和选段。

在立项时回传定位检查中可比较证据、被排除的证据和缺的信号。群像章传导演确认的 `sceneMode` 和行动表给现有章包工具，主笔只收到已编译的 packet。工具核对人物与出处，结论不当成真实读者数据。
