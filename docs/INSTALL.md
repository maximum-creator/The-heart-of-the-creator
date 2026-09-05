# 安装与新书复用

## 完整新项目

1. 安装 FeelFish 和可在终端运行的 Node.js（本仓库 CI 使用 Node.js 22）。确认 `node --version` 能输出版本。
2. 从 GitHub Releases 下载发布 ZIP，保留原始 ZIP 作为母版。每本书解压到独立目录，可以改目录名。
3. 在解压后的项目根目录运行：

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\initialize-novelos.ps1
   ```

4. 用 FeelFish 打开这个目录，选择自定义方案 `NovelOS 番茄超级写作者`，确认主智能体为 `NovelOS 总导演`。
5. 检查 11 个 Agent、16 个 Skills 的关联；模型服务和可用型号由你的账号提供，安装包不附带额度。模型名是宿主路由标识，并非对官方 API 可用性的承诺。
6. 从 `NovelOS/tools/mcp-server/mcp-config.local.json` 复制本机 MCP 配置到 FeelFish。只把这组工具分配给工具与上下文管理员。
7. 参考 `examples/minimal-run/` 开始立项。示例是虚构输入，不是已经生成并获读者认可的小说。

## MCP 必须指向当前书

生成配置中的 `cwd` 和 `env.NOVELOS_PROJECT_ROOT` 应当都是当前书的绝对目录。程序实际优先使用 `NOVELOS_PROJECT_ROOT`，其次使用进程工作目录。

“已连接、8 个工具”只证明工具已加载。可通过工具管理员执行 `novelos_project_snapshot`，将返回的项目文件清单与当前书的文件对照。不同书不要误用同一个固定项目根目录。复制或移动项目后，重新生成对应路径配置；已有 local 配置不会被初始化脚本自动覆盖。

## 已在 FeelFish 创建新书

“从其他项目导入”可用于导入 Agent 和 Skills，但尚未验证它会携带整个 `NovelOS/` 目录、运行脚本和本机 MCP 配置。只看到角色卡片不等于完整安装。

对已有正文的书，先备份再迁移；不要用空模板覆盖已有状态账本、章节、人物或自定义配置。最容易确认完整性的方式是将发布包解压为一个新项目，再有选择地迁入已有作品内容。导入出现 EPERM 时先停止重复点击、保存工作并关闭应用；错误可能来自文件占用或权限，仅凭该错误不能断言是重复导入。

## 母版与运行副本

- 原始 ZIP 作为分享母版，不在里面写书。
- FeelFish 打开解压目录后可能添加会话、秘书记录、Git 元数据或保存方案，这是运行副本的变化。
- 分享时发送原始发布 ZIP；不要重新压缩写过书的项目作为公共母版。

## 本地检查

在当前书的根目录运行：

```powershell
node NovelOS/tools/config/check-system-topology.mjs
node NovelOS/tools/config/sync-model-routing.mjs
```

第一个检查方案、Agent、Skill 引用等；第二个只检查模型配置是否与映射一致。需要改模型时先编辑 `NovelOS/00-control/capability-model-map.json`，再运行同步脚本的 `--write`，写入前会保留备份。检查结果不证明宿主会保留所有参数，也不验证市场效果；保存方案后如有疑问可重新检查。
