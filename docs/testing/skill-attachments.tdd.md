# 技能附件交付验证（2026-09-06）

用户需求：必要文档随技能分发，市场版不依赖脚本或包外工程目录；保护已有小说，明确完整版与市场版边界。

RED：28ab048，新增同技能附件、缺失附件、目录越界、编码越界测试，运行 node --test tests/marketplace.test.mjs，2 通过、4 失败，原因是检查器把本地附件统一视为外部依赖且没有具体路径检查。

GREEN：92981cb，同一组测试 6/6 通过。node --test --experimental-test-coverage tests/marketplace.test.mjs：修改的 check-marketplace.mjs 行覆盖 94.37%、分支 88.57%、函数 100%。模型策略模块仅被部分分支调用，其完整测试另由 model-parameters.test.mjs 覆盖。

检查器验证本包采用的 assets/、references/ 相对附件写法，并检查绑定、缺文件、外部程序引用和参数规则；不等于任意 Markdown 或任意恶意配置的完整安全解析器。市场实传、实际读取附件、真实模型协作、长篇质量和收益没有由这些本地测试验证。
