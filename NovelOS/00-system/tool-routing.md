# 工具路由

- 项目概况：先调用 `novelos_project_snapshot`，不要递归读取整个项目。
- 章节上下文：调用 `novelos_context_pack`，明确列出 focusFiles 和字符上限。
- 跨章词组重复：调用 `novelos_repetition_scan`，其结果只是定位信号，必须回到上下文判断。
- 事实缺口：不传文件路径调用 `novelos_fact_gaps` 扫描未解决标记；命中后由研究编辑核验。成稿已有事实契约时，由工具管理员同时传 `draftFile` 与 `contractFile`，执行本地事实契约检查并保存回执，随后交硬逻辑审计员。审计模式不传 `maxResults`；工具出错、缺 kind 或输入版本不匹配均不能算已完成。
- 成本预估：昂贵或多 Agent 任务前调用 `novelos_cost_estimate`。
- 外科修订单：匿名盲审锁定且唯一主损失需要 LOCAL 返修时，调用 `novelos_revision_order`；它校验审稿/回执/候选三方哈希，只新建一份带目标范围与冻结范围的 JSON。NONE 不写文件，STRUCTURAL 退回架构师，禁止手抄回执或覆盖旧修订单。
- 章节总验收：全部原始证据齐备后，仅由工具管理员调用 `novelos_chapter_acceptance`。输入、输出必须是 `records/` 或 `NovelOS/09-evals/` 下的项目相对 JSON；工具固定读取正式生产路由注册表，以不可覆盖方式写入完整回执，只返回决策、失败码、路径与哈希。它不调用模型、不自动重试、不改正文、不提交 Canon。
- 项目内事实：优先文件读取、全文问答和语义搜索；外部最新市场或史实才使用互联网搜索。
- 工具输出写入产物路径，子 Agent 只读产物摘要，不重复调用同一工具。

## 本地按需工具

下列脚本不单独注册为 MCP；事实契约检查复用现有 `novelos_fact_gaps` 的显式文件参数入口，其余命令须由已验证的本地执行入口运行。不能仅凭 Agent 说明写了脚本名就宣称已执行：

| 脚本 | 何时运行 | 作用 |
|---|---|---|
| `NovelOS/tools/eval/prose-cadence.mjs` | 定稿前或标点版式异常时 | 只定位连续碎句、长墙段、破折号等异常 |
| `NovelOS/tools/eval/story-debt-audit.mjs` | 每5章、卷中换挡或卷审 | 检查承诺、活跃问题和伏笔的到期与链接，不强迫立即填坑 |
| `NovelOS/tools/eval/t05-hard-audit.mjs` | T05 模型输出落盘后 | 零模型检查字数、系统面板、自评回声、廉价章末装置与最低因果信号；语义质量仍由匿名盲审决定 |
| `NovelOS/tools/eval/t06-hard-audit.mjs` | T06 候选稿落盘后 | 零模型检查字数、载荷与单程约束、禁用救援、游泳圆场和廉价尾钩；限知、人物删除测试与沉浸仍由盲审决定 |
| `NovelOS/tools/eval/t07-hard-audit.mjs` | T07 关系冲突候选稿落盘后 | 零模型检查时限、核心人物、胶卷去向、遗书解释和强行和解；潜台词与关系余波仍由盲审决定 |
| `NovelOS/tools/eval/t08-hard-audit.mjs` | T08 商业开篇候选稿落盘后 | 零模型检查前置承诺、人数/物证闭合、系统与外援捷径；阅读动力、专业可信度和长线吸引力仍由盲审决定 |
| `NovelOS/tools/context/build-cache-context.mjs` | 正文请求前且上下文清单发生变化时 | 编译字节稳定的固定前缀与本章变量后缀，输出哈希和字符数；不注册 MCP，不发模型请求 |
| `NovelOS/tools/eval/fact-contract-audit.mjs` | 成稿包含专业事实、关键数值或操作步骤时 | 经工具舱的 `novelos_fact_gaps(draftFile, contractFile)` 执行，回执带输入哈希；拦截未授权数值、步骤和明确禁写结论，不证明来源本身真实 |
| `NovelOS/tools/eval/narrative-fingerprint.mjs` | 当前稿完成后或跨章 AI 味复审时 | 定位精确长词组复现、总结式收尾、开场/结尾模式和共享情绪载体；只预警，不自动改文 |
| `NovelOS/tools/eval/raw-prose-delivery-audit.mjs` | 正文模型原始回复落盘后首先运行 | 阻断推理、自评、规则回声和包装层；禁止抽取清洗后冒充一次通过 |
| `NovelOS/tools/eval/prose-candidate-gate.mjs` | 单次正文候选的最后统一入口 | 聚合原始交付、标点段落、叙事指纹、任务硬门、真实成本和重试证据；只有生产注册表达标后才允许自主提交状态 |
| `NovelOS/tools/eval/transition-contract-audit.mjs` | 最终稿通过正文门、状态管理员准备提交差量时 | 对照章前最多3项状态边界，核验人物能动性、保护事实、未解决问题、最终稿哈希和原句证据；复用状态提取，不新增模型调用 |
| `NovelOS/tools/eval/chapter-acceptance-gate.mjs` | 所有单项门完成、准备进入声线确认、批次确认或正式 Canon 时 | 从同一运行目录重读并绑定预检、原始回复、最终稿、事实契约、转移契约、差量、路由、真实账单、一次授权和回滚点；本地重跑门禁，不新增模型调用；只允许已验证 PRODUCTION 路由自主提交 |
| `NovelOS/tools/eval/paid-run-authorization-gate.mjs` | 价格已经现场核对、即将进行一次真实付费正文发送前 | 只接受60分钟内准确输入/输出/缓存/推理分项费率和15分钟内当次授权，并绑定模型、场景、正文舱哈希、思考、重试与最大积分；公开价格档位或混合价不能放行，只产生一次性不可变回执，不发送请求 |
| `NovelOS/tools/eval/build-blind-pack.mjs` | 至少两份同任务候选已分别通过各自硬门后 | 只打包显式指定测试；用固定种子匿名排序，可加入冻结参考稿，私有映射保存前后哈希并与审稿目录隔离；发现正文内部身份泄露则落盘前停止 |
| `NovelOS/tools/eval/blind-review-gate.mjs` | 匿名包至少有两份稿、审稿者尚未查看身份映射和成本时 | 锁定每份稿的硬结论、主要损失、返修范围和原文证据；要求所有两两组合均引用双方原句并判断差异是否可感；只验证审稿完整性，不替代审美或晋级路由 |
| `NovelOS/tools/eval/build-surgical-revision-order.mjs` | 锁定盲审要求 LOCAL 返修时 | 经工具舱的 `novelos_revision_order` 执行；从原句自动计算允许修改行与其余冻结行，绑定回执/候选哈希并限制一次局部修订，不调用模型 |
| `NovelOS/tools/eval/route-trial-gate.mjs` | 盲审已锁定并准备揭晓身份、连接真实账单时 | 绑定盲审哈希、匿名稿哈希、原始回复哈希、模型注册、实际Token/积分与返修范围；明显落后、任意返修、重试或超预算均不得增加稳定次数；单次只产试验回执，禁止直接晋级 |
| `NovelOS/tools/eval/route-calibration-gate.mjs` | 同一模型已积累候选试验回执并取得一次整章声线确认时 | 只计算不同runId、不同scenarioId和不同原稿哈希的零返修通过；三次及以上且声线确认绑定具体回执时仅提出PILOT补丁，不写注册表、不允许直达PRODUCTION |
| `NovelOS/tools/eval/pilot-batch-gate.mjs` | PILOT 已完成5—10章、准备申请正式自主生产时 | 绑定校准回执、每章验收回执/最终稿、跨章指纹、故事债、声线漂移、P0、体验退回与不可变积分；只提出待落盘的PRODUCTION补丁，生产证据缺路径或SHA-256时拓扑继续阻断 |
