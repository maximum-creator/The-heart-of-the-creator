---
name: pro-evidence
description: 按 Pro MCP 的工具契约核验交接。
---


先用 `novelos_pro_plan_chapter` 核对批准基准、所需事实键和风险。把返回的已批准事实、原文引句、来源章号和稿件哈希交给审计员；Carbon 只收必要事实与从快照取得的尾段。用 `novelos_pro_check_packet` 验证写手章包。

用 `novelos_pro_check_delivery` 传实际原始响应。有上游结束回执才附 finishEvidence，scope 为 UPSTREAM_RESPONSE，并写明回执引用。缺回执走人工确认，截断先保存逐字原稿。用 `novelos_pro_lock_issue` 锁定唯一逐字引文，再用 `novelos_pro_apply_edit` 计算改稿。原稿、阅读稿与修订稿分别保存。作者在本地批准正式状态。
