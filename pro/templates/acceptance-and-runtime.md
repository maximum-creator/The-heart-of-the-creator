# 运行回执与正式状态交接

## 分项核对运行参数

路由目标见 `model-routes.json`。Sol 调度常规章使用 medium，卷级重排用 high；连续性审计按风险升档。Carbon 与 Opus 从 medium 起步，Astra 卷级复核用 high。省略温度、top_p 和 top_k。FeelFish 推荐档与建议预算以实际调用回执确认。

用同一次调用的脱敏请求与响应填 `runtime-observation.example.json`。记录实际请求模型、实际返回模型、服务商与请求 ID、档位、发出的最大输出 Token、输入、思考及可见 Token、结束原因、耗时和费用。思考与可见 Token 依据计费详情拆分，不能从字数或一个 completion 合计反推。无明确字段留空。场景架构、盲读和局部编辑三条 Sonnet 路由分别核验。Sol 总导演额外核对实际工具调用与子会话分派。回执不要含正文、提示、密钥或原始头部。

```powershell
node NovelOS/tools/pro/runtime-audit.mjs model-routes.json novelos-pro-dramaturg FAST runtime-observation.example.json
```

示例回执会报告 UNVERIFIED_RUNTIME。只有来源确实涵盖上游请求与响应、字段齐全且和预期一致，才会给 OBSERVED_VALUES_MATCH。仅看到 FeelFish 界面或本地配置最多填 HOST_ONLY。脚本检查提交的证据字段，不对来源签名或验证服务商。

## 从原稿走到批准快照

先在项目外选一个只在本地保存、支持硬链接的目录（例如 NTFS 上的私有目录），作为 vault。候选文件存到该目录之外也可以。每一稿使用自己的 runId，初始章从 1 开始，第一次使用 GENESIS；续写通过 context 获得已批准章号和基准版本。

| 命令 | 入参 | 行为 |
|---|---|---|
| raw | vault、候选 JSON 文件 | 留存逐字响应，截断稿也能保存 |
| inspect | vault、候选 JSON 文件 | 检查章节、前版、稿件、修订与当前差量，返回给审计员要绑定的哈希 |
| stage | vault、候选 JSON 文件 | 确认连续性审计针对当前稿件和差量，把完整候选不可覆盖地保存 |
| approve | vault、bookId、runId、候选哈希、作者批准引用 | **由作者本地执行**。核验后一次性发布当前章正文和状态快照。没有上游停止回执时再传 `--manual-delivery-reviewed` |
| context | vault、bookId、必要状态键列表 | 从最新已批准快照提取最多 10 条指定事实及 600 字原文尾段，未找到的键单列 |
| read | vault、bookId | 作者读取最新批准快照，适用于核对与备份 |

候选关键字段见包内 `canon-candidate.example.json`。审计员核对上一批准快照、锁定的最终正文和候选差量，逐条确认知识来源、人物承诺、位置与物件变化。通过后把前版、finalSha256、changesSha256、PASS 和审计记录引用填进 audit。MCP 的局部替换回执只能确认修改范围。审计结论的内容仍需真实的人或独立审计岗位判断。

新候选填 `evidenceKeys`，列出实际采用的已批准事实键，无继承事实时用空数组。把 inspect 返回的 `evidenceSha256` 加入 audit 后再暂存。已有候选可继续读写，缺依赖记录的旧批准章在影响报告中列为待人工复核。

给需要长期追踪的 `promise:` 或 `foreshadow:` 差量加 `thread`，例如 `{"id":"铺门旧账","dueChapter":24,"status":"open"}`。兑现时提交带正文出处的变更并设为 `resolved`，批准后调度停止提醒，快照保留最初埋设位置和当前证据。

```powershell
node NovelOS/tools/pro/canon.mjs raw <vault> canon-candidate.example.json
node NovelOS/tools/pro/canon.mjs inspect <vault> canon-candidate.example.json
node NovelOS/tools/pro/canon.mjs stage <vault> canon-candidate.example.json
node NovelOS/tools/pro/canon.mjs approve <vault> example-book chapter-01-a <候选SHA256> <作者批准记录> --manual-delivery-reviewed
node NovelOS/tools/pro/canon.mjs context <vault> example-book "knowledge:伙计.钥匙位置"
```

上例含离线制作的虚构素材、哈希和审计引用，只用于流程演练。正式写作使用真实收集的稿、审计和作者批准。没有上游结束回执的稿件仍需作者人工确认场景已结束。明确截断的稿件只留存，不进入批准命令。发生竞争时，同一本书同一章只会有一个获准快照；同稿重复执行返回已批准。旧审批或错误的下一章基准会被退回。此包不把正式批准命令暴露给 Agent 或 MCP。

## 跨章离线核对

选已有卷纲里一处埋线和一处后续兑现。从卷纲提取风险与所需事实键，调用 `novelos_pro_plan_chapter`。核对是否分给 Sol 常规审计、是否需要 Sonnet 架构，以及是否触发 Astra 卷级复核。再换旧版次或未入库的事实键验证阻塞路径。私有大纲和草稿留在本地核对。

此流程可用已有的批准快照或测试用快照复现，验收阶段无需生成正文。正式连载按一条完整卷线及下卷衔接评价人物声线、设定错误、伏笔兑现和作者改稿时间。
