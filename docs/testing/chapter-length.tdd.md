# 章节目标与单段排版补缺证据

依据用户提供的审查文档核对现有代码，仅补章节范围与单段极长提醒，不调整情节或模型路由。

用户路径：设定本书目标 → 用最终稿验收 → 缺目标或超范围不能自动提交；单段很长 → 定位复审而非自动修改。

RED：be82990 添加 4 项测试，运行 node --test tests/chapter-length.test.mjs，4 失败；失败分别为无单段提醒、无通用字数结果、无缺配置提醒、无范围校验。
GREEN：726786e 修正后同 4 项全部通过，并补充统一验收集成测试，合计 6 项通过。

验证命令：node --test --experimental-test-coverage --test-coverage-include=NovelOS/tools/eval/chapter-length.mjs tests/chapter-length.test.mjs tests/chapter-length-integration.test.mjs

新增字数模块覆盖率：行 100%，分支 97.50%，函数 100%。这是该模块覆盖率，不是整个工程覆盖率。

验证包括标题排除、BOM/CRLF、扩展汉字、标点外文表情、上下界、空正文、未批准目标、非法类型与口径、策略越界路径、最终稿和策略哈希绑定，以及合成生产态从通过转为需复审。合成回执仅用于测试，不是实际写作运行证据。

未验证：FeelFish 实际请求、市场重新上传、真实移动端显示效果、文学质量与平台字数口径。未调用付费模型。
