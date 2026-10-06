# Development

## 工作流程

```text
Issue → Feature Branch → Commit → Pull Request → Merge
```

1. Issue：定义任务目标、范围与验收标准。
2. Feature Branch：从团队约定的主分支创建任务分支，例如 `chore/day1-foundation`。
3. Commit：按可独立理解的修改拆分提交，使用 `chore:`、`docs:`、`feat:`、`fix:` 等前缀。
4. Pull Request：说明问题、修改结果、验证方式及未完成事项。
5. Merge：完成审核及必要检查后合并。

Task 1 已通过 GitHub Pull Request 合并到 main。Task 2 在 `feat/agent-ui-shell` 开发，仅 UI 与演示交互；本任务不 push、创建 PR 或 merge。

## 开发原则

- 先检查现有文件与 Git 状态，保留有效代码，不覆盖无关修改。
- 每次只完成约定的任务范围。Day 1 不开发 Memory、RAG、Agent、Supabase 或模型 API。
- 文档明确区分 Implemented 与 Planned。
- 使用环境变量管理凭据；不提交真实密钥、数据库密码、Supabase Secret、个人机器路径或环境文件。
- 避免过早引入复杂 UI 框架与基础设施。
- 提交前检查差异，执行与修改相关的验证。

## Web 开发与验证

在 `web/` 中执行：

```sh
npm ci
npm run dev
```

提交前验证：

```sh
npm run lint
npm run build
npm run typecheck
```

构建会生成 Next.js 类型声明，因此全新 checkout 可按以上顺序验证。打开首页确认内容与基础样式正常。后端和 Connector 暂无运行命令。

## 已知依赖问题（2026-10-06）

联网 `npm audit` 报告 5 项 high，均来自开发期 ESLint 配置的 `fast-glob → micromatch → braces` 依赖链。
根因是 [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)，公告目前没有补丁版本。
不使用 `npm audit fix --force` 将 Next.js ESLint 配置降级到旧主版本。后续应跟踪上游修复，修复发布后更新锁文件并重新验证。
ESLint 9 的安装还提示该版本已停止支持；当前保留与 Next.js 插件兼容且经过验证的配置，后续需在插件兼容后升级。

## Day 1 提交边界

- `chore: initialize web application`：Web 代码、配置、依赖锁文件及生成文件/环境文件忽略规则。
- `chore: add project workspace structure`：后端和 Connector 占位说明、空值环境变量示例。
- `docs: add architecture and development documentation`：项目 README、架构及开发流程。

## Task 2 演示边界

用户、任务、项目进度、记忆与文件列表均为固定示例。Agent 时间线手动推进，设置选择仅在页面内存中保存。上传、检索、编辑、删除与服务连接按钮明确禁用。无后端请求、模型接入、RAG、Memory 存储或本地操作。
