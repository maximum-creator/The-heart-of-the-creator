# NovelOS 最小端到端示例

这个示例只演示接口，不提供可复制的成品剧情，也不调用付费模型。

1. 把 `reader-contract.example.md` 的内容按新书改写后保存到 `NovelOS/01-market/reader-contract.md`。
2. 让总导演根据读者契约生成故事圣经和第一章 Chapter Packet。
3. Packet 闭合后，总导演调用正文作者生成一版正文。
4. 工具管理员运行重复、事实和状态一致性检查；只有命中具体问题才升级审计或局部编辑。
5. 定稿后，状态管理员先更新 `entity-state-ledger.json`，再同步 Markdown 视图并运行 `novelos_state_audit`。

可直接发送给主智能体：

```text
请按 FAST 模式为这本新书完成第一章生产。先读取读者契约，只调用会改变决定的最小团队；生成闭合 Chapter Packet 后只写一版正文。确定性门先行，只有具体失败才局部升级，不自动重试，不并行生成第二稿。
```
