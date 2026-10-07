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

Task 1、Task 2 与 Task 3 已完成项目基础架构、Workspace UI 和 Supabase 认证。Day 2 / Task 1 建立 Next.js AI Gateway 与 OpenAI、DeepSeek、Gemini、Ollama Provider；Day 2 / Task 2 接入 Agent Chat；Day 2 / Task 3 添加确定性 Auto Router、Privacy 本地模式和受限 fallback。当前 Ollama Provider 仅由能访问该 Ollama 服务的 Next.js 服务端调用。

## 开发原则

- 先检查现有文件与 Git 状态，保留有效代码，不覆盖无关修改。
- 每次只完成约定的任务范围；尚未明确纳入任务的 Memory、RAG、智能质量路由、Agent Planning、Tools、Agent Backend 与业务数据库不提前实现。
- 文档明确区分 Implemented 与 Planned。
- 使用环境变量管理凭据；不提交真实密钥、数据库密码、Supabase Secret、个人机器路径或环境文件。
- 避免过早引入复杂 UI 框架与基础设施。
- 提交前检查差异，执行与修改相关的验证。
- Ollama 本地 Provider 通过 `OLLAMA_BASE_URL` 与 `OLLAMA_MODEL` 配置，默认连接 `http://127.0.0.1:11434` 的 `qwen3:8b`。本地推理不产生云 API Token 费用，输入交由本机 Ollama 处理。
- 如果 Next.js 运行在云端，`127.0.0.1` 指云服务器自身，不能直连开发者电脑的 Ollama；需要服务器可达的 Ollama 服务，或后续实现受控 Local Connector。
- AI Auto Router 采用固定规则，不执行模型评估：本地 Ollama 可用时优先；否则尝试最多两个已配置候选。只有 Provider 错误或超时可 fallback；认证、输入校验和限流错误不得 fallback。显式选择 Provider 不切换。
- Privacy 模式只允许本地 Ollama；不可用时要清楚失败，不得尝试云 Provider。Provider 配置与可用性是独立字段；云 Provider 未执行真实调用前健康状态保持 unknown。
- 不用易失内存计数器模拟 per-user daily quota。面向公网开放付费云 Provider 前，先实现跨实例持久化的用户配额和拒绝策略。
- Vercel 端无法访问用户电脑的 localhost。当前没有 Local Connector，不能把本地模型健康状态解读为用户个人电脑可连接。

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

Dashboard、Memory 与 Knowledge Base 中的用户、任务、项目进度、记忆与文件列表均为演示示例。Agent Workspace 已连接 AI Gateway，Timeline 只记录真实聊天请求阶段。当前对话保存在前端内存，刷新后清空；不持久化 Supabase 会话数据，不实现 Memory、RAG、Agent Planning、Tool Calling 或 Local Connector。

Ollama `qwen3:8b` 已通过本机 Gateway 真实推理验收。对话文本发送给配置的 Ollama 服务处理，不产生云 API Token 费用。若 Next.js 部署在 Vercel，`127.0.0.1` 指向 Vercel 运行环境，无法访问用户电脑上的 Ollama；需等待后续 Local Connector 方案。

## Task 3 认证验证

- 无 `web/.env.local` 或两个配置为空：`/login`、`/signup` 可访问，显示未配置提示；受保护页面返回登录。
- 填入真实项目的公开配置并重启：测试错误密码、确认密码不一致、注册与邮箱确认、登录、刷新保持登录、五个页面导航、退出以及退出后再次访问受保护页面。
- Supabase Email provider、邮箱确认开关与 Redirect URLs 需在用户的项目控制台设置；应用不管理这些外部配置。
- 密码和 session token 不记录到日志，不存入业务数据库。主要配置采用 `NEXT_PUBLIC_SUPABASE_URL` 与 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`，仅公开 publishable key 可传到浏览器；旧 anon key 仅作为兼容回退。
- 没有真实项目时，不能声称已完成真实邮件发送或实际项目的认证联调。

本阶段已验证无配置的生产页面和登录跳转，并通过临时本地认证测试服务检查密码不一致、Loading/Error、等待确认提示、登录、刷新、页面导航与退出。伪造 session Cookie 被拒绝。测试服务与虚构配置不写入产品代码。真实 Supabase 联调已确认邮箱验证、密码登录、Session Cookie、Proxy 与 Workspace claims 验证及进入 Dashboard 成功；真实账号的刷新、完整导航、退出与重新登录需按上述清单分别验收。

## 本地网络排查

浏览器登录成功但仍返回 `/login` 时，检查 Node 服务端是否能访问 Supabase。浏览器通过系统代理联网，并不代表 Node 会自动采用该代理；`getClaims()` 网络验证失败时，应用仍会拒绝受保护页面。

如果 Node 无法直连 Supabase，可在启动开发服务器前，为当前终端配置代理环境变量。以下示例适用于本次验证使用的 Node 24.19.0；将 `<proxy-port>` 替换为本地代理实际端口：

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:<proxy-port>"
$env:HTTPS_PROXY = "http://127.0.0.1:<proxy-port>"
$env:NO_PROXY = "localhost,127.0.0.1,::1"
$env:NODE_USE_ENV_PROXY = "1"
npm run dev
```

这些设置仅影响当前终端及其子进程；重启开发服务器后生效。不要将个人代理地址提交到 Git，也不要使用 `NEXT_PUBLIC_` 变量传递代理配置。排查时仅记录认证状态布尔值，禁止记录密码、密钥、Token 或 Cookie 内容；不关闭邮箱验证或放宽服务器鉴权。
