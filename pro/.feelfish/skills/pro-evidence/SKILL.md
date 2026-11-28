---
name: pro-evidence
description: 按 Pro MCP 的工具契约核验交接。
---


先用 `novelos_pro_plan_chapter` 核基准、故事线和到期风险。导演作出选择后用 `novelos_pro_prepare_chapter` 编译章包并回传哈希。Carbon 只收编译好的 packet，已批准事实引句和来源交审计员。旧章拟变更时向 `novelos_pro_review_impact` 传原批准稿哈希、当前基准和明确的变更范围。

用 `novelos_pro_check_delivery` 原样传 raw、runId 和 handoff。实际捕获回执由本地操作者登记。找不到可对应的回执时交作者复核；模型偏离 Carbon、回执错配或明确截断时保存原稿并停止。用 `novelos_pro_lock_issue` 锁定逐字引文，再用 `novelos_pro_apply_edit` 计算改稿。原稿、阅读稿与修订稿分别保存。

用 `novelos_pro_evaluate_work` 核对载体、四段故事线和制作要求；终审时原样传本次成品或由本地 CLI 读文件。保持 OFFLINE_ONLY、缺真实证据、版本失效和作者批准的区别。只转交工具结论和佐证，不把该工具当作读者调查或桌读。
