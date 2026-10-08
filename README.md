# Personal AI Assistant

面向大学生和年轻职场人的 Web Personal AI Agent，目标是帮助用户组织学习、工作与个人知识。

## 在线体验

🌐 **Live Demo：**  
https://personal-agent-seven-mu.vercel.app

### 当前版本

**Personal AI Workspace — Auth、Memory 与多 Provider AI Gateway**

当前已实现：

- ✅ Next.js Web 应用基础架构
- ✅ Personal AI Agent Workspace
- ✅ Dashboard
- ✅ Agent Execution Timeline UI
- ✅ Personal Memory UI
- ✅ Knowledge Base UI
- ✅ Settings
- ✅ Supabase 用户注册 / 登录 / 退出
- ✅ 服务端身份认证与受保护路由
- ✅ Vercel 公网部署

> OpenRouter 在本地及 Vercel 的真实调用已有阶段性人工验收记录；线上部署内容仍应按实际发布版本核对。AI 自动记忆、知识库、Agent Planning 与工具能力仍在开发中。

## 比赛项目目标

通过统一的 Web 入口，逐步探索个人 AI 助手如何结合模型、个人记忆、知识检索和工具，提供可理解、可控的个性化支持。

## 当前开发阶段

**Memory-aware Agent。** `/memory` 使用 Supabase Postgres 与 authenticated Session 实现手动 CRUD；`/agent` 在服务端按当前登录用户检索有限的 Personal Memory，并作为不可信背景数据注入模型上下文。数据库 RLS 仍是最终行级边界。AI 自动记忆、Embedding、Semantic Search、Vector RAG 与 Knowledge Base 检索仍未实现。

## 技术架构概览

```text
当前：Browser → Agent Chat (Next.js) → Authenticated AI Gateway → Session-scoped Memory Retrieval (Supabase + RLS) → Safe Context → Rule-based Model Router → OpenRouter / OpenAI / DeepSeek / Gemini / Ollama
未来：Browser → Next.js Web → FastAPI → Personal Agent → Memory / RAG / Tools
                                                       └→ Windows Local Connector
```

Supabase 用于认证与 Personal Memory 持久化。Agent Chat 的 Auto 路由优先选取本地可用的 Ollama；本地不可用时优先考虑已配置的 OpenRouter，再考虑其他云 Provider。云 Provider 只显示配置状态，健康状态保持未知，真实调用失败后才可按规则尝试下一个候选。用户也可以显式选择 Provider，显式选择不触发切换。FastAPI Agent 与 Windows Local Connector 仍为规划。OpenRouter 已完成真实上游验收；OpenAI、DeepSeek 尚无真实成功验收记录，Gemini 仍受上游权限限制。

```text
web/          Next.js + TypeScript + Tailwind CSS + App Router
server/       FastAPI 后端占位说明
connector/    Windows Local Connector 占位说明
docs/         架构与开发流程
.env.example  不含密钥的环境变量示例
```

详细边界见 [架构文档](docs/architecture.md)。

## 本地运行

要求 Node.js >= 20.9（建议使用受支持的 LTS 版本）与 npm。

```sh
cd web
npm ci
npm run dev
```

打开 http://localhost:3000。未登录时进入 `/login`。未配置 Supabase 时应用可正常启动，登录/注册显示配置提示且提交按钮禁用。

检查及生产运行：

```sh
npm run lint
npm run typecheck
npm run build
npm run start
```

首次安装后，Next.js 在运行或构建时自动生成 `next-env.d.ts`。首次单独执行类型检查前，可先执行 `npm run build`。

## Automated Regression Tests

在 `web/` 运行 `npm test`。该命令使用 Vitest 单次执行并退出，覆盖 AI Router、Privacy、显式 Provider、Auto fallback、输入边界、公开错误响应、Memory Context 与少量 Chat Route Handler 行为。测试采用确定性的 fake Provider、fake 配置和受控认证/Memory 替身；不会调用真实 OpenRouter、OpenAI、DeepSeek、Gemini 或 Ollama，也不需要云 API Key、Supabase Secret 或本地 Ollama 服务。`npm run test:watch` 仅供开发时使用。

自动回归测试补充独立的真实 Provider 人工集成验收，不替代上游联调。Ollama、OpenRouter、Privacy、Auto 云切换与双用户 Memory 隔离已有阶段性人工验收；OpenAI、DeepSeek 和 Gemini 不因此视为已通过真实调用。

### Windows 一键运行

环境要求：Windows 10/11、Node.js LTS（至少满足 `web/package.json` 中的版本要求）、npm 和 Ollama。运行 `qwen3:8b` 建议准备 16 GB 内存，并为模型和依赖预留至少 10 GB 磁盘空间；实际速度取决于电脑配置。Ollama 在用户自己的电脑运行，本地模型推理不会产生云 API Token 费用。

首次在项目根目录双击 `setup-personal-agent.bat`。脚本会检查 Node.js 与 Ollama、确认 Ollama 服务和 `qwen3:8b` 模型、使用 `npm ci` 安装 Web 依赖、创建（但不覆盖）`web/.env.local` 模板并执行 Production build。模型缺失时会先询问是否下载；模型约数 GB，耗时取决于网络。若本机缺少 Node.js 或 Ollama，脚本会说明安装要求，不会静默安装系统软件。

然后在 `web/.env.local` 填写 Supabase 项目的 `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`，再双击 `start-personal-agent.bat`。后续启动不重复安装依赖或下载模型。脚本会优先使用 3000 端口，端口占用时查找后续空闲端口；服务健康后打开默认浏览器，并在窗口显示访问地址。按 `Ctrl+C` 停止 Web 服务。若网络需要代理，可从终端运行 `start-personal-agent.ps1 -ProxyUrl "http://127.0.0.1:<proxy-port>"`；不传参数时使用系统网络。代理设置仅作用于该次脚本和其启动的子进程。

## 当前已实现功能

- `/login`、`/signup`：邮箱密码认证、确认密码校验、Loading/Error 状态及邮箱确认回调。
- Supabase 官方 `@supabase/ssr` 浏览器/服务端客户端，Cookie 会话、Proxy 刷新与服务端身份校验。
- Dashboard / Agent / Memory / Knowledge / Settings 未登录时跳转 `/login`；侧栏展示认证邮箱及退出入口。
- 统一侧边导航与 Dashboard：今日重点、项目、最近任务、演示记忆与继续任务入口。
- `/agent`：真实 AI Chat Workspace，可查看 Provider 配置状态、选择模型、发送多轮对话、查看请求状态、重试和清空会话。
- Agent 对话通过 `POST /api/ai/chat` 使用认证后的 Next.js AI Gateway；Ollama `qwen3:8b` 已完成真实本地推理验收。
- Agent Timeline 显示 Received、Validating、Retrieving Memory、Routing、Generating、Completed；Memory 仅作为当前用户的安全上下文，不模拟 Planning、RAG 或工具调用。
- `/memory`：通过 `GET/POST /api/memories` 与 `GET/PATCH/DELETE /api/memories/[id]` 访问当前用户的 Personal Memory，支持新增、编辑、删除、加载/空/错误状态；服务端从已验证 Session 获取 `user_id`，不接受客户端指定所有权字段。
- `/knowledge`：演示文件列表；上传与检索暂不可用。
- `/settings`：模型、自主程度的本地 UI 选择，以及服务商/连接器占位。
- `POST /api/ai/chat`：认证后支持 Auto 或显式选择 OpenRouter、OpenAI、DeepSeek、Gemini、Ollama；验证输入并返回统一的非流式文本结果。Auto 按规则路由并最多尝试两个候选；显式选择不回退。
- `GET /api/ai/providers`：认证后只返回 Provider 名称、类型、配置状态、可用性和模型显示信息，不包含地址或密钥。Ollama 通过短超时模型列表检查；云 Provider 保持健康未知。
- Ollama 本地推理默认使用 `qwen3:8b`，不需要云 API Token；输入在配置的本地 Ollama 服务处理，不向云模型 Provider 发送。
- TypeScript 严格类型配置、Tailwind CSS 样式。
- ESLint、类型检查与构建脚本，npm 锁文件。
- 后端与本地连接器占位目录。
- 环境变量示例、敏感文件忽略规则与架构/开发文档。

Agent 对话只保存在前端内存，刷新后清空；发送时只传递最近且符合 Gateway 限制的消息。Gateway 在服务端使用当前登录 Session 和 RLS 查询最多 8 条记忆，并在 4000 字符及剩余输入预算内注入；客户端不能提交 Memory Context。Dashboard 与 Knowledge Base 仍使用标明的演示内容。当前没有 AI 自动记忆、Embedding、Semantic Search、Vector RAG、文件读取或命令执行。

## Planned Features

- FastAPI 后端与 Personal Agent。
- AI 自动提取 Memory、Embedding、Semantic Search 与个人知识 Vector RAG。
- Agent Planning、Tools 与 Windows Local Connector。
- per-user daily quota 与 Streaming。
- Windows Local Connector、本地文件与受控命令执行。当前 Next.js 服务端只能访问自身网络可达的 Ollama；部署在 Vercel 时，`127.0.0.1` 指 Vercel 运行环境，不能访问用户电脑上的 Ollama。

## 配置与安全

所有 API Key 和数据库凭据必须由环境变量提供。根目录 `.env.example` 不含真实密钥；AI Provider 的私密 Key 只在服务端读取。

Next.js 只读取 Web 应用目录中的环境文件。将以下配置填入 `web/.env.local`：

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=
GEMINI_API_KEY=
GEMINI_MODEL=
OPENROUTER_API_KEY=
OPENROUTER_MODEL=openrouter/free
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:8b
```

使用 Supabase 项目的 Project URL 和 publishable key。配置优先读取 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`；未填写或仅含空白时兼容旧的 `NEXT_PUBLIC_SUPABASE_ANON_KEY`。两者同时存在时使用 publishable key。严禁把 service_role、secret key 或数据库密码填入这些公开变量。至少为希望使用的云 Provider 配置对应 Key；模型变量可覆盖集中默认值。OpenRouter 使用服务端 `OPENROUTER_API_KEY`，默认模型为 `openrouter/free`，不向浏览器返回 Key。Ollama 使用服务端变量 `OLLAMA_BASE_URL` 与 `OLLAMA_MODEL`，默认地址为 `http://127.0.0.1:11434`，默认模型为 `qwen3:8b`。本地推理不产生云 API Token 费用，但会占用本机计算资源。修改后重启开发服务；生产环境修改后需重新构建。根目录示例不会自动被 Web 加载。

登录后可从同源页面调用 `GET /api/ai/providers` 查看配置与可用性，再向 `POST /api/ai/chat` 发送 `{"provider":"auto","routingPreference":"auto","messages":[{"role":"user","content":"你好"}]}`。也可明确设置 `provider` 为 `openrouter`、`openai`、`deepseek`、`gemini` 或 `ollama`。Auto 最多尝试两个 Provider，且只有上游错误或超时才会切换；鉴权、请求校验、限流错误不会切换。Privacy 偏好只允许已确认可用的 Ollama，无法使用时直接失败。显式选择 OpenRouter 或 Auto 路由到它时，当前用户的受限 Personal Memory Context 会随请求发送到云端；需要仅本地处理时选择 Privacy。请求最多 20 条消息、单条 4000 字符、总计 16000 字符、请求体 64 KiB。服务端对显式调用设置 25 秒超时、Auto 每个候选设置 12 秒超时，输出最多 1024 token。API 不接受系统角色消息，也不返回 Key。

使用 Ollama 时，需要让运行 Next.js 的服务器能访问 `OLLAMA_BASE_URL`。本地开发可在机器上运行 Ollama；部署到 Vercel 等云端时，`127.0.0.1` 指云端服务器自身，无法直接访问开发者电脑上的 Ollama。当前没有 Local Connector。公开启用付费云 Provider 前，必须先增加持久化 per-user daily quota；本阶段不使用易失内存计数器冒充可靠限额。

在 Supabase Auth 开启 Email provider。设置 Site URL 为本地开发地址，并在 Redirect URLs 中允许 `http://localhost:3000/auth/callback`（部署时使用实际站点地址）。开启邮箱确认时，注册后按提示在同一浏览器打开邮件链接，回调交换 PKCE code 后进入 Dashboard；若没有即时 session，页面不会假装已经登录。关闭邮箱确认时，注册得到 session 后直接进入 Dashboard。此应用不自动更改 Supabase 的认证策略。

登录成功后进入 `/`；退出只注销当前浏览器会话并返回 `/login`。认证校验失败或服务不可用时不会放行受保护页面。没有配置的本地环境无法登录，也无法直接查看工作空间。

参考 [Supabase 官方 Next.js SSR 文档](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs)。未来后端私密配置放在 `server/.env` 并由后端加载，私密值不得使用 `NEXT_PUBLIC_` 前缀。

`.env` 及 `.env.*` 默认被 Git 忽略，仅 `.env.example` 可提交。不得提交真实密钥、个人机器路径或生成文件。

开发协作流程见 [开发文档](docs/development.md)。
