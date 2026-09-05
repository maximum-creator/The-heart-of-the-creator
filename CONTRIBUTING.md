# 贡献指南

欢迎修复导入兼容性、改进中文长篇状态检查、补充可复现用例与文档。

提交问题请注明系统、FeelFish 与 Node.js 版本，描述操作步骤、预期行为与实际结果。截图和日志先去掉密钥、个人路径、账户信息、未公开正文与读者后台数据。

修改前先说明具体问题，保持改动范围有限。模型、温度与技能调整需说明作用和代价；不要仅凭模型自评声称质量提升，也不要为了消除一个警告而给所有 Agent 挂满工具。

运行公开回归：

```sh
node --test tests/*.test.mjs
node NovelOS/tools/config/check-system-topology.mjs
node NovelOS/tools/config/sync-model-routing.mjs
```

测试不调用付费模型。使用虚构的小型夹具，不提交真实小说、账户配置、API Key 或完整会话。代码测试通过与 FeelFish 实际导入成功分别记录。正文体验变化应使用有合法使用权的样本、明确的比较方法和反馈，不编造用户量或效果数字。
