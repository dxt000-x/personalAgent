# Personal AI Assistant

面向大学生和年轻职场人的 Web Personal AI Agent，目标是帮助用户组织学习、工作与个人知识。

## 在线体验

🌐 **Live Demo：**  
https://personal-agent-seven-mu.vercel.app

### 当前版本

**Personal AI Workspace — Auth、Memory、Knowledge Grounding 与多 Provider AI Gateway**

当前已实现：

- ✅ Next.js Web 应用基础架构
- ✅ Personal AI Agent Workspace
- ✅ Dashboard
- ✅ Agent Execution Timeline UI
- ✅ Personal Memory UI
- ✅ Knowledge Base UI
- ✅ 用户主动启用的知识库辅助 AI 回答
- ✅ Settings
- ✅ Supabase 用户注册 / 登录 / 退出
- ✅ 服务端身份认证与受保护路由
- ✅ Vercel 公网部署

> OpenRouter 在本地及 Vercel 的真实调用已有阶段性人工验收记录。知识库上传、Storage 保存、处理、片段生成、搜索和 Chat Grounding 的 Production 验收已由维护者确认并[归档](docs/releases/b2-knowledge-final.md)；本次文档校准未重新执行生产测试，也不代表全部异常恢复或跨账号写操作均已验收。独立测试项目已通过 A/B 双向检索隔离、ready/deleting 过滤及页面搜索；uploading、processing、failed 的真实过滤仍待验证。AI Gateway 上游 4xx 不可恢复错误的分类修复已随 PR #38 上线，真实上游 4xx 故障场景尚未生产实测。智能记忆候选提取已实现，仍待人工联调；自主 Agent Planning、工具调用与 Local Connector 尚未实现。

## 比赛项目目标

通过统一的 Web 入口，逐步探索个人 AI 助手如何结合模型、个人记忆、知识检索和工具，提供可理解、可控的个性化支持。

## 当前开发阶段

**Memory-aware Agent 与可选 Knowledge Grounding。** `/memory` 使用 Supabase Postgres 与 authenticated Session 实现手动 CRUD；`/agent` 在服务端按当前登录用户检索有限的 Personal Memory。用户主动开启知识库并提供关键词后，Chat 还会检索该用户的 `ready` 知识片段，将实际选中的有限摘录作为不可信引用资料加入模型上下文；无匹配时不调用模型。数据库 RLS 仍是最终行级边界。Agent 的智能记忆建议默认关闭，启用后仅生成候选，用户确认后才保存。当前采用关键词匹配，不包含 Embedding、Semantic Search 或 Vector RAG。

## 技术架构概览

```text
当前：Browser → Agent Chat (Next.js) → Authenticated AI Gateway ┬→ Session-scoped Memory Retrieval (Supabase + RLS) ─┐
                                                         └→ optional Knowledge Keyword Search (ready chunks + RLS) ─┴→ Safe Context → Rule-based Model Router → OpenRouter / OpenAI / DeepSeek / Gemini / Ollama
未来：Browser → Next.js Web → FastAPI → Personal Agent → Memory / RAG / Tools
                                                       └→ Windows Local Connector
```

Supabase 用于认证、Personal Memory、知识库元数据与片段存储；私有 Storage 保存知识库原件。Agent Chat 的 Auto 路由优先选取本地可用的 Ollama；本地不可用时优先考虑已配置的 OpenRouter，再考虑其他云 Provider。云 Provider 只显示配置状态，健康状态保持未知，真实调用失败后才可按规则尝试下一个候选。用户也可以显式选择 Provider，显式选择不触发切换。FastAPI Agent 与 Windows Local Connector 仍为规划。OpenRouter 已完成真实上游验收；OpenAI、DeepSeek 尚无真实成功验收记录，Gemini 仍受上游权限限制。

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

在 `web/` 运行 `npm test`。该命令使用 Vitest 单次执行并退出，覆盖 AI Router、Privacy、显式 Provider、Auto fallback、输入边界、公开错误响应、Memory Context、候选提取与确认交互。测试采用确定性的 fake Provider、fake 配置和受控认证/Memory 替身；不会调用真实 OpenRouter、OpenAI、DeepSeek、Gemini 或 Ollama，也不需要云 API Key、Supabase Secret 或本地 Ollama 服务。`npm run test:watch` 仅供开发时使用。

自动回归测试补充独立的真实 Provider 人工集成验收，不替代上游联调。Ollama、OpenRouter、Privacy、Auto 云切换与双用户 Memory 隔离已有阶段性人工验收；OpenAI、DeepSeek 和 Gemini 不因此视为已通过真实调用。

### AI Gateway 超时与安全诊断

`POST /api/ai/chat` 和 `POST /api/ai/memory-candidates` 都声明 `maxDuration = 30` 秒，并从请求开始实行 **27 秒整次请求 Deadline**，为响应收尾保留约 3 秒。显式 Provider 原有上限 25 秒、Auto 每候选原有上限 12 秒；每次尝试还受整次剩余时间限制。Auto 在有第二候选时尽量为其留出 4 秒，剩余少于 2 秒不启动新的云端调用。Ollama 健康检查仍限 1.5 秒，Personal Memory 查询仍限 2 秒。到期返回安全的 `TIMEOUT`；此时间预算并不保证上游本身会在限定时间内完成。

服务端每个 AI 请求最多记录一条 `ai_gateway_request` 结构化日志：随机 requestId、接口、路由模式、实际尝试的 Provider、阶段耗时、尝试次数、Memory 失败类别与最终错误码。日志不记录消息、模型回复、Memory 内容、身份标识、Cookie、Token、Key 或完整 URL。用 `memoryFailureKind=timeout|database|network` 辅助排查 `memory.status=unavailable`；认证失败仍返回 401。底层 SDK 操作若无法取消，服务端会停止等待并拒绝迟到结果，但不能保证底层工作立即停止。

`qwen3:8b` 的**记忆候选提取**请求使用经本地 `/api/show` 元数据确认支持的 Ollama `think: false`；普通聊天维持原有思考行为，其他模型不假定支持该参数。`openrouter/free` 会在可用免费模型中选路，具体模型与延迟可能变化；偶发 TIMEOUT 的上游根因仍需真实环境分阶段日志和故障注入验证。当前没有更换生产模型或调整线上环境变量。

### Windows 一键运行

环境要求：Windows 10/11、Node.js LTS（至少满足 `web/package.json` 中的版本要求）、npm 和 Ollama。运行 `qwen3:8b` 建议准备 16 GB 内存，并为模型和依赖预留至少 10 GB 磁盘空间；实际速度取决于电脑配置。Ollama 在用户自己的电脑运行，本地模型推理不会产生云 API Token 费用。

首次在项目根目录双击 `setup-personal-agent.bat`。脚本会检查 Node.js 与 Ollama、确认 Ollama 服务和 `qwen3:8b` 模型、使用 `npm ci` 安装 Web 依赖、创建（但不覆盖）`web/.env.local` 模板并执行 Production build。模型缺失时会先询问是否下载；模型约数 GB，耗时取决于网络。若本机缺少 Node.js 或 Ollama，脚本会说明安装要求，不会静默安装系统软件。

然后在 `web/.env.local` 填写 Supabase 项目的 `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`，再双击 `start-personal-agent.bat`。后续启动不重复安装依赖或下载模型。脚本会优先使用 3000 端口，端口占用时查找后续空闲端口；服务健康后打开默认浏览器，并在窗口显示访问地址。按 `Ctrl+C` 停止 Web 服务。若网络需要代理，可从终端运行 `start-personal-agent.ps1 -ProxyUrl "http://127.0.0.1:<proxy-port>"`；不传参数时使用系统网络。代理设置仅作用于该次脚本和其启动的子进程。

## 当前已实现功能

- `/login`、`/signup`：邮箱密码认证、确认密码校验、Loading/Error 状态及邮箱确认回调。
- Supabase 官方 `@supabase/ssr` 浏览器/服务端客户端，Cookie 会话、Proxy 刷新与服务端身份校验。
- Dashboard / Agent / Memory / Knowledge / Settings 未登录时跳转 `/login`；侧栏展示认证邮箱及退出入口。
- 统一侧边导航与 Dashboard：今日重点、项目、最近任务、演示记忆与继续任务入口。
- `/agent`：真实 AI Chat Workspace，可查看 Provider 配置状态、选择模型、发送多轮对话、主动开启 Knowledge Grounding 并指定检索关键词、查看真实来源、查看请求状态、重试和清空会话。
- Agent 对话通过 `POST /api/ai/chat` 使用认证后的 Next.js AI Gateway；Ollama `qwen3:8b` 已完成真实本地推理验收。
- Agent 可选择开启智能记忆建议：聊天成功后单独分析本轮用户消息，展示最多 3 条候选；点击确认后复用 `POST /api/memories` 保存，忽略则不写入。
- Agent Timeline 显示 Received、Validating、Retrieving Memory、Routing、Generating、Completed；服务端按当前用户生成受限 Memory Context，并在用户开启时加入受限 Knowledge 引用上下文，不执行 Agent Planning 或工具调用。
- `/memory`：通过 `GET/POST /api/memories` 与 `GET/PATCH/DELETE /api/memories/[id]` 访问当前用户的 Personal Memory，支持新增、编辑、删除、加载/空/错误状态；服务端从已验证 Session 获取 `user_id`，不接受客户端指定所有权字段。
- `/knowledge`：当前账号的 PDF、TXT、Markdown 文件列表、直传、服务端正文解析与有序片段、处理状态、删除及已上线的关键词搜索。搜索接口 `POST /api/knowledge/search` 支持可选 `documentId` 精确过滤，只查询当前用户的 ready 片段；Agent Chat 可在用户主动开启并指定关键词后复用此服务端检索，将有限摘录作为不可信资料提供给模型，并返回实际使用的来源。生产 Migration、受限 Writer、三种格式的上传解析与删除、指定文档的 A/B 直接读取隔离已验收；B2 Production Search 与 Chat Grounding 的 PASS 结论见[归档记录](docs/releases/b2-knowledge-final.md)，不是本次重新实测。独立测试项目已实测指定文档 A/B 双向搜索隔离、ready 命中、deleting 排除、不带 `documentId` 的四次交叉搜索与页面流程；夹具已精确清理，响应中的 `documentId` 字段当次未直接捕获核验。uploading、processing、failed 的真实过滤及剩余异常恢复、跨账号写操作仍待验收。
- `/settings`：模型、自主程度的本地 UI 选择，以及服务商/连接器占位。
- `POST /api/ai/chat`：认证后支持 Auto 或显式选择 OpenRouter、OpenAI、DeepSeek、Gemini、Ollama；验证输入并返回统一的非流式文本结果。Auto 按规则路由并最多尝试两个候选；显式选择不回退。
- 云端 AI 每用户每日 30 次预占限制已在 Gateway 与迁移文件中实现；目标环境的迁移部署及真实并发验收状态须单独核实，不以代码存在代替数据库验收。
- `GET /api/ai/providers`：认证后只返回 Provider 名称、类型、配置状态、可用性和模型显示信息，不包含地址或密钥。Ollama 通过短超时模型列表检查；云 Provider 保持健康未知。
- Ollama 本地推理默认使用 `qwen3:8b`，不需要云 API Token；输入在配置的本地 Ollama 服务处理，不向云模型 Provider 发送。
- TypeScript 严格类型配置、Tailwind CSS 样式。
- ESLint、类型检查与构建脚本，npm 锁文件。
- 后端与本地连接器占位目录。
- 环境变量示例、敏感文件忽略规则与架构/开发文档。

Agent 对话只保存在前端内存，刷新后清空；发送时只传递最近且符合 Gateway 限制的消息。服务端使用当前登录 Session 与 RLS，从该用户的 Memory 中按 `created_at`、`id` 获取最多 200 条较新候选，再结合最新用户消息，按 importance、关键词匹配、类别提示与最近更新时间确定性重排；同分时依次按 importance、`updated_at`、`created_at`、`id` 排序。最终最多 8 条、总长最多 4000 字符的 Memory Context 还受对话剩余输入预算约束，内容视为不可信数据；客户端不能提交该 Context。用户主动开启知识库时，服务端另将当前用户 ready 文档的有限关键词匹配片段作为不可信引用资料加入上下文；无匹配不调用模型。Dashboard 仍使用标明的演示内容。当前没有 Embedding、Semantic Search、Vector RAG、工具文件读取或命令执行。

## Planned Features

- FastAPI 后端与 Personal Agent。
- 更丰富的 Memory 语义去重、Embedding、Semantic Search 与个人知识 Vector RAG。
- Agent Planning、Tools 与 Windows Local Connector。
- Streaming 与更细的 token/费用预算。
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

登录后可从同源页面调用 `GET /api/ai/providers` 查看配置与可用性，再向 `POST /api/ai/chat` 发送 `{"provider":"auto","routingPreference":"auto","messages":[{"role":"user","content":"你好"}]}`。也可明确设置 `provider` 为 `openrouter`、`openai`、`deepseek`、`gemini` 或 `ollama`。Auto 最多尝试两个 Provider，仅可恢复的 Provider 故障或超时才会切换；上游 401/403、其他不可恢复 4xx 及 429 不切换，408 按超时处理。Privacy 偏好只允许已确认可用的 Ollama，无法使用时直接失败。显式选择云 Provider 或 Auto 路由到云端时，当前用户的受限 Personal Memory Context 会随请求发送；仅当用户主动开启知识库时，实际选中的受限 Knowledge 片段也会发送给最终调用的 Provider。需要仅本地处理时选择 Privacy。请求最多 20 条消息、单条 4000 字符、总计 16000 字符、请求体 64 KiB。服务端对显式调用设置 25 秒超时、Auto 每个候选设置 12 秒超时，且两者均受整次 27 秒 Deadline 约束；输出最多 1024 token。API 不接受系统角色消息，也不返回 Key。

使用 Ollama 时，需要让运行 Next.js 的服务器能访问 `OLLAMA_BASE_URL`。本地开发可在机器上运行 Ollama；部署到 Vercel 等云端时，`127.0.0.1` 指云端服务器自身，无法直接访问开发者电脑上的 Ollama。当前没有 Local Connector。

### 云端 AI 每日配额

在部署包含配额检查的 Web 版本前，先由维护者审查并在对应 Supabase 项目执行 [`supabase/migrations/20261008190000_create_ai_daily_usage.sql`](supabase/migrations/20261008190000_create_ai_daily_usage.sql)。本仓库未自动执行该迁移。迁移未部署或数据库不可用时，云端调用会安全失败；本地 Ollama 和 Privacy 不依赖配额数据库。

每个用户每个 **UTC 日期最多预占 30 次云端 AI Gateway 请求**，在下一个 UTC 日期 00:00 重置。首次尝试云 Provider 前预占一次；上游成功或失败均计一次，同一请求在云 Provider 间 fallback 不重复计数。未配置 Provider 在尝试前被拒绝时不计数。此计数是云端请求次数，**不代表 token 用量或真实费用**。额度用尽时返回 HTTP 429 `CLOUD_QUOTA_EXCEEDED`；数据库无法核验时返回 HTTP 503 `QUOTA_UNAVAILABLE`，均不调用云模型。匿名、无效输入、Ollama 和 Privacy 不消耗云额度。

配额由 Supabase PostgreSQL 的原子 UPSERT 维护，可跨 Vercel 实例共享。自动测试使用 fake RPC；真实 PostgreSQL 并发与权限验收仍待在隔离测试项目完成，步骤见 [开发文档](docs/development.md)。

### 个人知识库文件（已部署生产，仍有待验收项目）

[`supabase/migrations/20261009120000_create_knowledge_base.sql`](supabase/migrations/20261009120000_create_knowledge_base.sql) 已在独立 Supabase 测试项目 `personal-agent-quota-test` 部署并完成文档/片段 RLS、私有 Storage、A/B 隔离及 C/D 并发与限额验收。测试夹具已清理并经只读复核，测试事件保留供审计。PR #32 已合并到 `main`（`15c3ab5`），Vercel Production Deployment 已成功；生产 Supabase 迁移、专用 `knowledge_writer_login` 与受限连接已部署并核验。生产 TXT、Markdown、PDF 上传解析、片段生成、删除及 Storage 清理已通过；A/B 页面列表隔离及 B 的 `GET /api/knowledge` 返回 200 与空 `documents` 已通过。维护者的生产只读清理复核显示测试文档、片段、Storage 对象和孤立对象均为 0；内部审计事件可按设计保留。独立测试结果不代替生产未完成项目的验收。

安全审查后，五个处理/删除例程位于不暴露给 Data API 的 `knowledge_private` Schema；普通 authenticated JWT 没有执行权限。Next.js 验证用户 claims 后，使用专用 `knowledge_writer_login` 数据库连接调用这些例程。服务端需要 Supabase Shared Transaction Pooler 的 `KNOWLEDGE_DB_URL` 和用于 TLS 证书/主机名验证的 `KNOWLEDGE_DB_CA_CERT_BASE64`；缺少配置时安全失败。该凭据不使用 `service_role`，也不能直接读写知识库表；它仍是服务端敏感凭据，须审计数据库对 `PUBLIC` 的其他默认权限及全部适用于 authenticated 的 Storage 策略。部署顺序和隔离项目验收见 [开发文档](docs/development.md)。

支持 PDF、UTF-8 TXT 和 Markdown，单文件上限 4 MiB。浏览器使用当前 Supabase 登录态将文件直接上传到按用户/文档生成的私有 Storage 路径；Next.js 仅接收小型元数据 JSON。服务端随后重新下载原件，验证实际字节数、PDF 头与解析结果或文本 UTF-8/二进制特征，再拆成有序片段。这样文件请求不经过 Vercel Function 的 [4.5 MB 请求体限制](https://vercel.com/docs/functions/limitations)；Supabase [标准直传](https://supabase.com/docs/guides/storage/uploads/standard-uploads)适用于当前 4 MiB 上限。

删除先标记 `deleting` 并使处理代次失效，再通过 Storage API 移除原件，最后删除文档并级联删除片段；Storage 失败时保留可重试状态。确定性的格式/解析失败标记 `failed` 并尝试清理原件；临时错误尽量标记可重试的 `failed` 并保留原件，数据库不可用导致标记失败时可在处理超时后重领。单用户最多 100 个文档、累计声明容量 100 MiB，每 UTC 小时最多初始化 20 次、领取处理 60 次；单文件仍限 4 MiB。未完成的上传可在页面继续处理或删除；长时间卡住的处理在 10 分钟后可重新认领，旧代次不能提交。扫描版、加密版或无文字 PDF 无法提取；本阶段不提供 OCR、Embedding、语义检索或 Vector RAG。自动测试使用假 Supabase/Storage；独立测试项目已通过 TXT/Markdown/PDF 真实上传、A/B 隔离及数据库并发与限额验收。100 MiB 验证的是数据库声明容量，并非实际上传 100 MiB。生产已通过指定测试文档的普通用户直接跨账号片段与原件只读隔离；跨账号处理/删除拒绝、Storage 删除失败及损坏文件残留恢复、完整数据库恢复演练仍待完成。步骤见 [开发文档](docs/development.md)。

### 智能记忆建议（已实现，待人工联调）

在 Agent 页面主动勾选“智能记忆建议”；默认关闭。聊天回复显示后，页面只把本轮用户消息送往独立的 `POST /api/ai/memory-candidates`，由真实模型判断长期偏好、持续目标、项目或工作学习背景。普通问候、临时问题和不确定事实可返回零候选；最多展示 3 条。只有点击“确认保存”才调用现有 `POST /api/memories`；“忽略”、关闭开关、清空对话或切换账号都不会保存未确认候选。保存后下一轮聊天可按现有 Memory Context 规则检索。

提取复用 AI Gateway 的 Router 与 Provider，不会读取其他个人记忆给提取模型。Privacy 只调用本地 Ollama；Auto 和显式 Provider 沿用现有规则。**独立的云端提取请求会额外预占一次每日云额度，即使模型调用失败也计数**；本地 Ollama 不计。候选内容按当前用户已有 Memory 做完全一致及 Unicode/空格/标点规范化去重，确认时再检查一次。首版只覆盖简单文本重复，不做语义去重或跨会话并发唯一约束；模型建议仍需用户判断。模型输出异常、去重查询失败或配额不足不会撤回正常聊天回复。本功能不是 RAG，也不会更新模型权重。

在 Supabase Auth 开启 Email provider。设置 Site URL 为本地开发地址，并在 Redirect URLs 中允许 `http://localhost:3000/auth/callback`（部署时使用实际站点地址）。开启邮箱确认时，注册后按提示在同一浏览器打开邮件链接，回调交换 PKCE code 后进入 Dashboard；若没有即时 session，页面不会假装已经登录。关闭邮箱确认时，注册得到 session 后直接进入 Dashboard。此应用不自动更改 Supabase 的认证策略。

登录成功后进入 `/`；退出只注销当前浏览器会话并返回 `/login`。认证校验失败或服务不可用时不会放行受保护页面。没有配置的本地环境无法登录，也无法直接查看工作空间。

参考 [Supabase 官方 Next.js SSR 文档](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs)。未来后端私密配置放在 `server/.env` 并由后端加载，私密值不得使用 `NEXT_PUBLIC_` 前缀。

`.env` 及 `.env.*` 默认被 Git 忽略，仅 `.env.example` 可提交。不得提交真实密钥、个人机器路径或生成文件。

开发协作流程见 [开发文档](docs/development.md)。
