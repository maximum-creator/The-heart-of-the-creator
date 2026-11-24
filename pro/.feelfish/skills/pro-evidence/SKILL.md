---
name: pro-evidence
description: 按 Pro MCP 的工具契约核验交接。
---


用 `novelos_pro_check_packet` 验证章包。用 `novelos_pro_check_delivery` 传实际原始响应。只有上游结束回执时才附 finishEvidence，scope 为 UPSTREAM_RESPONSE 并写明回执引用。缺回执留人工确认，截断先保存逐字原稿。先锁定唯一逐字引文，再用 `novelos_pro_apply_edit` 计算改稿。原稿、阅读稿与修订稿三份独立保存。规则输出只能表示可送审或局部改动通过；阅读吸引力与 Canon 由编辑和作者决定。
