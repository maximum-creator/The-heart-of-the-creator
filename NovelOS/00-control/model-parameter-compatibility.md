# 模型参数兼容性（2026-09-05）

模型配置必须匹配实际路由，不能从榜单分数推导参数支持。移除不支持的参数意味着不发送字段，而不是填 0、1 或 null。

| 路由 | 本次处理 | 证据与边界 |
| --- | --- | --- |
| GPT-5.6 Luna | 移除 temperature，保留 low | 用户提供真实 400：Unsupported parameter temperature |
| GPT-5.6 Terra | 移除 temperature，保留 high | OpenAI 当前参数指导及 FeelFish 专属元数据；此路由未做付费复测 |
| GLM-5.3 | 思考开启、low，温度 0.78 保留 | 智谱明确禁止关闭思考 |
| GLM-5.3 Flash | 思考开启、low，温度 0.55/0.1 保留 | 官方说明文本参数同 GLM-5.3，禁止关闭思考 |
| Kimi K3 | 保留 max，不传温度 | FeelFish 当前专属元数据只列 max；官方模型始终思考 |
| DeepSeek V4 Flash | 保留关闭思考、0.05 | 官方与宿主均提供非思考模式和温度 |
| DeepSeek V4 Pro | 保留开启思考、high，不传温度 | 思考模式下温度无效，当前配置未传 |

## 已发现的宿主边界

本次读取 FeelFish 公共模型目录时，没有 GLM-5.3 和 Flash 的专属条目，只有通用 GLM 后备描述。客户端代码只有在模型目录提供 reasoningEffortOptions 时才组装所选思考档位。因此配置写 low 不等于已经证明最终请求携带 low；宿主可能采用供应商默认档位。不要宣称这两条路由的运行成本已验证。需要通过 FeelFish 请求明细核实实际请求。

宿主保存/上传方案可能去掉推荐配置里的 reasoningEffort，当前项目覆盖与可导入方案需要分别检查。不要修改历史会话来伪造新参数已生效；重新打开项目并用新会话验收。

检查程序验证已知配置冲突，不调用模型，不保证服务商路由可用或输出质量。本次没有执行付费生成测试。

## 来源

- https://developers.openai.com/api/docs/guides/latest-model
- https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3
- https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash
- https://api-docs.deepseek.com/guides/thinking_mode/
- https://forum.moonshot.ai/t/kimi-k3-is-here-our-most-capable-model/480
- https://www.feelfish.com/api/website/site-config/public?key=models_info
