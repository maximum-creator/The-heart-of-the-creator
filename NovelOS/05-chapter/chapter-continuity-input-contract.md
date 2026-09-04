# 章节连续性输入契约

统一章节验收必须明确当前稿属于独立校准题、全书首章还是连载章，不能靠空 `recentDrafts` 猜测。该契约只控制本地验收输入，不增加模型调用，也不把最近五章全文发送给正文模型。

## 三种模式

### `STANDALONE_CALIBRATION`

- 仅允许 `phase: CALIBRATION`。
- `recentDrafts` 必须为空。
- 用于 T11 之类不属于实际连载顺序的固定试镜题，不能进入 PILOT 或 PRODUCTION 自动提交。

### `FIRST_CHAPTER`

- `chapterOrdinal` 必须为 `1`。
- `recentDrafts` 必须为空。
- 可用于正式新书首章；不得把后续章节伪装为首章绕过跨章检查。

### `SERIAL`

- `chapterOrdinal` 必须为大于等于 `2` 的整数。
- `previousChapterOrdinal` 必须恰好等于当前序号减一。
- `previousChapterId` 必须存在且不能等于当前章节 ID。
- `previousDraft` 必须与 `recentDrafts[0]` 完全一致；第0项就是紧邻上一章最终定稿。
- `recentDrafts` 最多5项且不能重复。其余项目按由近到远排列，只供本地跨章指纹和模式复核。

示例：

```json
{
  "chapterId": "BOOK-CHAPTER-012",
  "chapterOrdinal": 12,
  "continuityContext": {
    "mode": "SERIAL",
    "previousChapterId": "BOOK-CHAPTER-011",
    "previousChapterOrdinal": 11,
    "previousDraft": "chapters/BOOK-CHAPTER-011.md"
  },
  "recentDrafts": [
    "chapters/BOOK-CHAPTER-011.md",
    "chapters/BOOK-CHAPTER-010.md",
    "chapters/BOOK-CHAPTER-009.md"
  ]
}
```

## 模型上下文与本地检查分离

- 正文作者最多接收800字符的上章尾段，只在理解开场所必需时使用；人物状态、未消化情绪和硬事实压入 Chapter Packet。
- 验收程序在本地读取 `recentDrafts` 的最终定稿全文并计算指纹，不产生模型 Token，也不把全文注入 FeelFish 会话。
- 命中 `CHAPTER_SEAM_REPLAY` 后，独立编辑只接收当前章首、上一章末、共享片段和状态变化，不接收五章全文或写作模型身份。

## 失败处理

契约缺失、序号不连续、紧邻上一章不在第0项、历史超过5章或路径重复时，统一验收返回 `REJECT`。修复输入证据后重跑本地门禁，不重写正文、不自动重试付费模型。
