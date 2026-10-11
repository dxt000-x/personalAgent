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

Task 1、Task 2 与 Task 3 已完成项目基础架构、Workspace UI 和 Supabase 认证。Day 2 / Task 1 建立 Next.js AI Gateway 与 OpenAI、DeepSeek、Gemini、Ollama Provider；Day 2 / Task 2 接入 Agent Chat；Day 2 / Task 3 添加确定性 Auto Router、Privacy 本地模式和受限 fallback。OpenRouter 云 Provider 已接入统一接口，并完成本地与 Vercel 的阶段性真实调用验收。当前 Ollama Provider 仅由能访问该 Ollama 服务的 Next.js 服务端调用。

## 开发原则

- 先检查现有文件与 Git 状态，保留有效代码，不覆盖无关修改。
- 每次只完成约定的任务范围；Personal Memory 手动 CRUD、RLS、受限服务端 Memory Context 与需用户确认的 AI 候选建议已建立。Embedding、Semantic Search、Vector RAG、智能质量路由、Agent Planning、Tools 与 Agent Backend 不提前实现。
- 文档明确区分 Implemented 与 Planned。
- 使用环境变量管理凭据；不提交真实密钥、数据库密码、Supabase Secret、个人机器路径或环境文件。
- 避免过早引入复杂 UI 框架与基础设施。
- 提交前检查差异，执行与修改相关的验证。
- Ollama 本地 Provider 通过 `OLLAMA_BASE_URL` 与 `OLLAMA_MODEL` 配置，默认连接 `http://127.0.0.1:11434` 的 `qwen3:8b`。本地推理不产生云 API Token 费用，输入交由本机 Ollama 处理。
- 如果 Next.js 运行在云端，`127.0.0.1` 指云服务器自身，不能直连开发者电脑的 Ollama；需要服务器可达的 Ollama 服务，或后续实现受控 Local Connector。
- AI Auto Router 采用固定规则，不执行模型评估：本地 Ollama 可用时优先；否则按 OpenRouter、Groq、OpenAI、DeepSeek、Gemini 考虑最多两个已配置候选。只有 Provider 错误或超时可 fallback；认证、输入校验和限流错误不得 fallback。显式选择 Provider 不切换。
- Privacy 模式只允许本地 Ollama；不可用时要清楚失败，不得尝试云 Provider。Provider 配置与可用性是独立字段；云 Provider 未执行真实调用前健康状态保持 unknown。
- OpenRouter 使用服务端 `OPENROUTER_API_KEY`，默认 `OPENROUTER_MODEL=openrouter/free`。显式选择或 Auto 路由到 OpenRouter 时，当前用户的受限 Memory Context 会发送到该云服务；Privacy 下不得发送。不要将 API Key、完整 Memory、Token 或 Cookie 写入日志。
- Groq 使用服务端 `GROQ_API_KEY` 与可选 `GROQ_MODEL`，当前默认 `openai/gpt-oss-20b`。通过现有 OpenAI SDK 的 Groq 兼容地址调用，SDK 自动重试关闭；显式选择或 Auto 路由到 Groq 时，当前用户的受限 Memory Context 会发送到该云服务，智能记忆候选提取若使用 Groq 则是独立云端请求。Privacy 不发送到 Groq。Groq 属于现有每日 30 次云请求配额范围；此计数不代表费用，亦不保证模型永久免费。本阶段只做离线测试，真实 Groq Key、目标数据库配额部署状态与生产联调尚未验证。
- Groq Chat Completions 使用 `max_completion_tokens`，保持现有输出 Token 上限。仅默认 `openai/gpt-oss-20b` 发送 `reasoning_effort: low`；自定义 `GROQ_MODEL` 不附加模型专属推理参数。智能记忆候选的 `disableThinking` 不能在 GPT-OSS 上完全关闭推理，`low` 仅降低推理强度；真实延迟和输出质量仍需联调。上游明确的 401/403 返回安全的 `PROVIDER_AUTH_FAILED`（502），408 返回 `TIMEOUT`（504），429 返回 `RATE_LIMITED`（429），其他 4xx 返回 `PROVIDER_REQUEST_REJECTED`（502）。仅 408 超时沿用可 fallback 规则；5xx 和无状态网络故障维持既有可恢复规则。
- 云端调用依赖 Supabase PostgreSQL 的持久化 per-user daily quota；迁移未部署或配额不可用时必须拒绝云调用。不要用易失内存计数器替代，也不要把 30 次请求计数解释为费用预算。
- Vercel 端无法访问用户电脑的 localhost。当前没有 Local Connector，不能把本地模型健康状态解读为用户个人电脑可连接。

## Web 开发与验证

在 `web/` 中执行：

```sh
npm ci
npm run dev
```

提交前验证：

```sh
npm test
npm run lint
npm run build
npm run typecheck
```

构建会生成 Next.js 类型声明，因此全新 checkout 可按以上顺序验证。打开首页确认内容与基础样式正常。后端和 Connector 暂无运行命令。

## Automated Regression Tests

`npm test` 使用 Vitest 单次运行并退出；`npm run test:watch` 是可选的开发模式。测试位于 `web/lib/ai/`、`web/app/api/ai/` 与 `web/components/`，使用 deterministic fake Provider、fake 配置与受控认证/Memory 替身。它们不访问真实云 Provider、Ollama 或 Supabase，不消耗 API 额度，也不依赖 `web/.env.local`。覆盖 Router 顺序与候选上限、Privacy 只在本地执行、显式 Provider 无 fallback、Auto 错误分类、输入边界、公开错误脱敏、Gateway Memory Context 与智能记忆候选/确认交互。

超时回归还覆盖整次 Deadline、客户端取消、Ollama/OpenRouter 超时、Auto 剩余预算、Privacy 无云调用、配额只预占一次、Memory 读取超时 fail-soft、迟到候选丢弃及结构化日志脱敏。自动测试只用 fake Provider/fetch/数据库替身；它不能证明真实 Ollama 推理、OpenRouter 免费模型调度、Supabase 网络或 Vercel 函数上限。

### AI 请求超时排查

- 两条 AI POST 路由声明 `maxDuration=30` 秒，从入口起计 27 秒总 Deadline。显式模型单次上限 25 秒，Auto 单次上限 12 秒；实际允许时间取各自上限与剩余总预算较小者。首个 Auto 候选在有后继时预留 4 秒；新的云调用至少要剩 2 秒，且先取得云配额。健康检查 1.5 秒，Memory 查询 2 秒。配额 RPC 与可取消的 HTTP 调用接收同一总取消信号。认证 SDK 不暴露可取消接口；Deadline 可以停止等待，但无法保证该底层操作停止。云配额若在取消前已由数据库提交，按原有无退款策略计数。
- 查找服务端 `event=ai_gateway_request` 日志中的随机 `requestId`、`endpoint`、`routingMode`、`provider`、`attemptNumber`、`authDurationMs`、`memoryDurationMs`、`routeDurationMs`、`quotaDurationMs`、`providerDurationMs`、`totalDurationMs`、`memoryFailureKind` 与 `finalErrorCode`。只输出实际经过的阶段；不含消息、回复、Memory、用户 ID、认证 Header、Secret 或完整 URL。请求被平台强制终止时可能没有最终日志。
- `memoryFailureKind=timeout` 表示查询取消信号到期，`database` 表示返回错误或无效数据，`network` 表示抛出异常的非超时路径；这是安全的粗分类，不能单凭它确定 Supabase、代理或数据库的具体根因。认证失败仍是 `AUTH_REQUIRED`，Memory 失败按原逻辑 `unavailable` 继续聊天。Memory 查询超时不会自动放宽，底层传输若忽略取消可能仍继续处理只读查询。
- `RATE_LIMITED` 对应已知上游 429；连接/响应取消对应 `TIMEOUT`；其他上游故障仍是安全的 `PROVIDER_ERROR`。使用 fake Provider 验证错误映射不等于真实上游故障注入。记录出现时间与阶段耗时后，在隔离环境逐一测试显式 Ollama、显式 OpenRouter、Auto 与 Memory，勿把间歇超时直接归咎于 GPU、免费模型或数据库。
- OpenRouter `openrouter/free` 由可用免费模型动态选路，延迟可能随实际模型变化。若计划固定一个免费模型，先比较相同 Prompt 的多次响应时间、可用率、模型能力与配额，再审查配置变更；本任务没有改生产 `OPENROUTER_MODEL`。本地 `/api/show` 元数据确认当前 `qwen3:8b` 支持 `think:false`，因此仅短的候选提取使用该参数；普通聊天不改。不同模型 tag 不自动启用。
- 人工验收仍需核对目标 Vercel 部署的函数限制与日志、Ollama 的排队和推理、OpenRouter 上游 429/5xx/超时、Memory 间歇 unavailable，以及 Privacy/配额边界。仓库声明的 30 秒不证明线上当前计划或部署设置；真实故障根因仍未定位。

真实 Provider 与双用户 Memory 隔离仍保留独立人工集成验收记录。自动测试不会将 OpenAI、DeepSeek 或 Gemini 记作真实调用成功。

## 云端 AI 配额部署与验收

配额代码对应新的 [`supabase/migrations/20261008190000_create_ai_daily_usage.sql`](../supabase/migrations/20261008190000_create_ai_daily_usage.sql)；历史 Memory migration 不变。先人工审查 SQL，在隔离测试 Supabase 项目执行并验收，再在目标项目部署，最后部署包含配额检查的 Web 版本。若先部署 Web，云端 Provider 会因缺少 RPC 返回安全的 `QUOTA_UNAVAILABLE`，本地 Ollama 与 Privacy 仍可工作。本任务不自动执行 SQL，也不修改 Vercel Production 环境。

`public.ai_daily_usage` 的主键是 `(user_id, usage_date)`；`usage_date` 取数据库 UTC 日期。`reserve_cloud_ai_quota()` 无参数，从 `auth.uid()` 获取用户，固定上限 30。表启用 RLS 且不给 `anon`、`authenticated` 直接读写权限；`SECURITY DEFINER` 函数固定空 `search_path`，仅授予 `authenticated` EXECUTE。直接调用 RPC 最多消耗调用者自己的额度，不能增加上限或退款。条件 UPSERT 在同一用户/日期的主键冲突上串行化更新，供所有 Vercel 实例共享。服务端在云 Provider 创建成功后、调用前预占；云端失败仍计一次，同一 Gateway 请求的云端 fallback 不重复计。Ollama、Privacy、未认证与输入无效不计。计数代表云端请求次数，不代表 token 或真实费用。

`npm test` 中的 quota 用例仅通过 fake RPC 验证应用边界，**不证明真实数据库并发原子性**。真实验收需在隔离测试项目先应用迁移，准备两个当天尚未调用配额 RPC 的新测试账号，通过正常登录获得各自的短期 JWT，然后在 `web/` 设置以下进程环境变量并运行：

```text
AI_QUOTA_TEST_PROJECT_KIND=isolated-test-project
AI_QUOTA_TEST_SUPABASE_URL=<隔离测试项目 URL>
AI_QUOTA_TEST_PUBLISHABLE_KEY=<该项目公开 publishable key>
AI_QUOTA_TEST_USER_A_JWT=<测试用户 A 的短期 JWT>
AI_QUOTA_TEST_USER_B_JWT=<测试用户 B 的短期 JWT>
```

```sh
node scripts/verify-ai-quota-concurrency.mjs
```

脚本不输出 JWT 或 Key，拒绝在未明确标为隔离测试项目时运行；请勿将变量写入仓库文件。每次重复验收使用**新的两个测试用户**，并避开 UTC 午夜前两分钟。它并发发送 40 次 A 的直接 RPC，要求恰好 30 次允许、10 次拒绝，检查 0–29 的唯一剩余值、A 的第 41 次拒绝、B 的独立额度、匿名 RPC 拒绝及直接表读写拒绝。脚本不会调用任何 AI Provider。真实执行结果须另行记录；当前标记为**待实测**。验收后再进行登录态云 Provider 人工联调与部署判断。

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

Dashboard 中的用户、任务与项目进度仍为演示示例。Knowledge Base 文件列表已改为真实 API/Storage 流程，独立测试项目已通过验收，生产已部署并完成文件接入及部分隔离验收；剩余安全和失败恢复场景见下文。Personal Memory 已改为 Supabase 手动 CRUD；Agent 在服务端读取当前用户的有限记忆并作为不可信背景上下文交给所选 Provider。智能记忆建议需主动开启，AI 只生成候选，不自动创建记忆。Agent Workspace 已连接 AI Gateway，Timeline 显示真实请求阶段。当前对话保存在前端内存，刷新后清空；不实现 RAG、Agent Planning、Tool Calling 或 Local Connector。

## Knowledge Base 基础关键词检索（B1 分支，独立项目部分实测）

`POST /api/knowledge/search` 接收最多 512 字节的 JSON，例如 `{ "query": "关键词", "documentId": "<已授权文档的 UUID>" }`；`documentId` 可省略，提供时精确限制到该文档，省略时检索当前登录用户的全部 ready 文档。关键词经修剪后为 1–100 个 Unicode 字母、组合符、数字或空格；`%`、`_`、`*` 及转义字符被拒绝，避免 ILIKE 通配符扩大匹配。接口先用 SSR Supabase Client 的 `getClaims()` 确认用户，再以同一 authenticated Client 和现有 RLS 查询当前用户的 ready 文档片段。数据库查询限时 3 秒，最多返回 5 条、每条摘录 600 字符、摘录合计不超过 4000 字符，只返回文档 ID、文件名、片段序号与摘录。失败返回固定安全错误，响应为 `Cache-Control: private, no-store`。不调用 Writer、Storage 或 AI，也不需要新 Migration。

Knowledge 页面展示搜索、加载、空结果与错误状态；结果按普通文本渲染，查询变化、卸载或账号切换后旧响应不能覆盖新状态。独立测试项目 `personal-agent-quota-test` 的普通 A/B 会话已通过指定文档的双向搜索隔离；指定 ready 文档精确搜索命中，随后同一合成文档在保留片段的 deleting 状态下，以相同关键词和 `documentId` 搜索返回 HTTP 200 与空结果。另一次验收（Run ID `ffe041f7-5d45-4779-a471-ea4de3c5bd60`）中，A/B 各上传一份唯一关键词的合成 TXT 并解析为 ready；不带 `documentId` 的正式搜索四次均返回 HTTP 200：A 搜 A 与 B 搜 B 各显示本人文件的 1 条结果，A 搜 B 与 B 搜 A 各返回 0 条。Knowledge 正常页面搜索流程 PASS。页面显示的唯一文件名可与登记文档对应，但本轮未直接捕获搜索响应 JSON 中的 `documentId` 字段，不能记为该字段已直接核验。两份夹具通过各自普通账号正常删除；按精确 ID 和路径只读复核，文档、片段及 Storage 对象均为 0。uploading、processing、failed 的真实过滤仍为 NOT RUN；deleting 是已实测的唯一非 ready 状态。Preview 部署检查 Success，但部署环境归属及登录后功能验收未确认；生产 B1 尚未部署或验收。独立测试 Worktree 全量 Vitest 为 306/309：3 项数据库验收入口环境守卫测试预期 WRONG_WORKTREE，实际在授权测试 Worktree 中触发 WRONG_PROJECT_KIND；安全守卫未放宽，不能记为全量通过。定向 B1 测试 38/38 通过。此前验收时同一文档出现两次 DELETE（204、503），第二次 503 的具体失败分支仍 UNKNOWN；历史 Origin 异常根因仅为 LIKELY。关键词匹配不等于语义检索、Embedding 或 RAG。

## Knowledge Base 文件接入与验收

迁移文件：[`supabase/migrations/20261009120000_create_knowledge_base.sql`](../supabase/migrations/20261009120000_create_knowledge_base.sql)。**独立测试项目** `personal-agent-quota-test` 已人工执行并验证迁移、`knowledge_documents` / `knowledge_chunks` 的 RLS、Storage 所有权策略、私有 Bucket、受限角色权限与跨用户隔离。**生产 Supabase** `personal-ai-assistant` 也已执行迁移，私有 Schema、表、RLS、Bucket、函数与限额触发器经维护者核验；生产专用 Writer 已创建，Session Pooler 5432 和 Transaction Pooler 6543 连接验证通过，最小权限检查 6/6 通过。PR #32 合并提交为 `15c3ab5`，GitHub Actions Ubuntu CI 通过，Vercel Production Deployment 状态 Ready；Production 已配置受限连接和 TLS CA 对应的服务端变量。以上为维护者提供的生产验收结果；生产普通用户直接读取片段/原件的 A/B 隔离现已完成单份文件实测，详情见下方。迁移同时创建 Bucket；若已有同名 Bucket 但配置不符会回滚。若某环境已执行旧版本，必须另写增量迁移，不能重复执行或假设当前版本已生效。

**可信解析结果的权限边界：** Browser 与 SSR Supabase client 共用 authenticated JWT，所以任何授给 authenticated 的完成 RPC 都可被用户直接调用。现在五个 SECURITY DEFINER 例程均在非 Data API Schema `knowledge_private`，并撤销 PUBLIC、anon、authenticated 的 EXECUTE。迁移只创建 `knowledge_writer` NOLOGIN 权限组；维护者审查后在隔离项目手动创建独立 `knowledge_writer_login` 登录角色、设置独立强密码，并授予该组：

```sql
create role knowledge_writer_login with login password '<独立生成的强密码>';
grant knowledge_writer to knowledge_writer_login;
grant connect on database postgres to knowledge_writer_login;
-- 在隔离项目核对：
select has_function_privilege('authenticated', 'knowledge_private.complete_knowledge_document(uuid,uuid,integer,jsonb)', 'EXECUTE'); -- false
select has_function_privilege('knowledge_writer_login', 'knowledge_private.complete_knowledge_document(uuid,uuid,integer,jsonb)', 'EXECUTE'); -- true
```

上方角色创建示例是历史部署步骤；生产项目已由维护者创建并核验独立 Writer，不应重复执行。从 Supabase Connect 面板复制 **Shared Transaction Pooler** 的主机与 `6543` 端口，以自定义角色建立仅供 Next.js Node.js 路由使用的 `KNOWLEDGE_DB_URL`。用户名应为 `knowledge_writer_login.<project-ref>`。再从 Supabase Database Settings 下载该数据库的 CA 证书，将其 PEM 内容 Base64 编码放入仅服务端的 `KNOWLEDGE_DB_CA_CERT_BASE64`。代码要求 Pooler 主机/端口、角色、CA、TLS 证书链与主机名验证；缺任一项即安全失败，不得改用 `rejectUnauthorized: false` 或 `sslmode=require` 跳过身份验证。URL 密码中的保留字符须百分号编码；不打印 URL、证书或凭据。[Supabase 连接文档](https://supabase.com/docs/guides/database/connecting-to-postgres)说明 Serverless 应用使用 Transaction Pooler，且证书验证需要显式 CA。[SSL 指南](https://supabase.com/docs/guides/platform/ssl-enforcement)说明 `verify-full` 的意义。

应用级 `pg.Pool` 在模块作用域延迟创建，每个温实例最多 **2** 个连接，连接等待 5 秒、空闲回收 10 秒、单查询客户端超时 10 秒；所有 SQL 使用无 `name` 的参数化查询，不建立跨事务会话状态或 prepared statement。Supabase 当前建议 Serverless 每实例先用 1 个连接，Vercel Fluid Compute 指南则提示 1 个连接可能压低同实例并发；此处维持有限的 2 个作为待观察折中，需继续关注生产排队、连接数和超时。[Supabase 池化说明](https://supabase.com/docs/guides/database/connecting-to-postgres)、[Vercel Fluid Compute 指南](https://vercel.com/kb/guide/connection-pooling-with-functions)。以下是部署前的历史检查项：核对 Vercel Fluid Compute 模式、Function 时限和环境变量作用范围。生产变量现已由维护者配置；本次文档更新未读取或修改其值。没有受限连接时上传初始化、处理和删除均安全失败。此方案不使用 `service_role`，但数据库自定义角色仍可能继承其他对象对 `PUBLIC` 的默认权限，生产权限检查已完成 6/6；凭据轮换仍需运维管理。密钥泄露时攻击者可能调用私有例程并伪造用户参数，因此仅部署在可信服务端。

状态机：`uploading` 只在 Storage 原件存在时可领取；`failed/temporary` 可由页面“重试处理”重新领取；确定性非法文件为 `failed/invalid_file`，只可删除并重新上传。领取在数据库行锁下返回递增 generation，10 分钟过期后可重领；旧 generation 的完成/失败均被拒绝。`deleting` 使代次失效，先删除 Storage，再确认对象不存在并级联删除文档/片段；删除失败保留记录供重试。非法文件清理失败保留 `failed` 元数据及原件供删除；临时失败保留原件。Storage/数据库间没有全局事务，孤儿对象巡检仍是运维事项。

资源约束由数据库 trigger 执行，即使 authenticated 直接插入元数据也生效：每用户最多 100 个文档、累计声明大小 100 MiB、每 UTC 小时 20 次初始化（即使随后删除也计数）。领取处理另限每用户每 UTC 小时 60 次，单文件仍为 4 MiB。计数是请求防滥用边界，不是物理存储或成本结算保证；真实 Storage 字节仍由服务端处理时核对。

[Vercel Function 请求体上限为 4.5 MB](https://vercel.com/docs/functions/limitations)，因此 `POST /api/knowledge` 只接收最多 4 KiB 的初始化 JSON，文件由浏览器的 Supabase 客户端直传私有 Bucket；4 MiB 也低于 [Supabase 标准上传建议的 6 MB 阈值](https://supabase.com/docs/guides/storage/uploads/standard-uploads)。Bucket MIME/大小、用户路径 RLS 是入口防线。服务端下载原件后再次核对大小、扩展名对应格式、PDF 头与解析结果、UTF-8 和明显二进制特征，拒绝空正文、超长正文、超过 50 页的 PDF 或超过 200 段的文档。PDF 使用 `pdfjs-dist` 提取文字；无 OCR。Markdown 作为原文保存，不执行 HTML。

PDF.js 4.10.38 在 Node.js 中从自身包目录加载 `pdf.worker.mjs`。Next.js 生产打包曾将 PDF.js 移入 `.next/server/chunks`，导致 worker 路径不存在，正常 Word 导出 PDF 被误报为解析失败；`web/next.config.ts` 通过 `serverExternalPackages: ["pdfjs-dist"]` 保持包与 worker 同目录，并在知识库处理路由的文件追踪中显式包含 worker。回归测试使用无用户资料的 Word 导出文字型及纯图片 PDF：正常文字提取、无文字层提示暂不支持 OCR、损坏 PDF 拒绝、50 页/4 MiB/正文/片段限制。未知 PDF.js 运行时故障按临时服务错误处理并保留原件供重试，不记录 PDF 正文。以上为当时的故障与修复记录；后续独立项目及生产环境均已完成 PDF 真实上传与解析验收。

自动化测试使用内存中的假数据库、Storage 和客户端；SQL 静态测试只约束迁移文本。它们不访问真实 Supabase，也不证明实际 GRANT、RLS、触发器并发或 Storage 事务。在**隔离测试项目**应用迁移并准备 A/B 两个测试账号、各自文档与可下载的原始 Storage 对象，以及 A/B 各一个未上传的文档记录（B 的记录应为 TXT）后，按 [`web/scripts/verify-knowledge-security.mjs`](../web/scripts/verify-knowledge-security.mjs) 中的 `KB_TEST_*` 变量执行 `node scripts/verify-knowledge-security.mjs`。脚本要求 Project Ref、短期 JWT、`KB_TEST_PENDING_DOC_B`、只用于异常上传清理的 `KB_TEST_CLEANUP_WRITER_URL` 与 TLS CA；核对 JWT 身份和真实对象后才验证 RPC、文档/片段 RLS、跨用户下载/列表/删除及 B 待上传路径上的 A 上传拒绝。若异常上传成功，受限写入角色先将该测试文档标为 deleting，再由 B 删除临时对象；清理失败时脚本返回失败并要求人工复核。凭据不得写入文档或提交。

新增的 `--interactive-storage` 模式专供 `personal-agent-quota-test`（Project Ref 固定为 `pxfaqcepztzqyqtmbdrf`），只允许从 `D:\龙虾\Codex\PersonalAgent-KB-Test\web` 的交互终端运行。复测时先在该测试 Worktree 同步需要的脚本提交，用 A/B 各自账号通过页面准备**恰好一份**文件名以 `kb-isolation-test-` 开头、状态 `ready` 的可丢弃文件；确认原文件确实可丢弃。将测试项目的 TLS CA PEM/CRT 放在 `D:\codex` 或测试 Worktree 下。随后在测试 Worktree 的 `web` 目录执行 `node .\scripts\verify-knowledge-security.mjs --interactive-storage`。脚本固定测试项目 URL，不读取任何 `.env.local`；交互隐藏输入 publishable key、A/B 邮箱密码和受限 `knowledge_writer_login` Pooler URL，要求人工输入项目名称及确认两份文件名。它验证本人下载、双向越权下载/删除后的大小和 SHA-256，最后用本轮唯一 B `uploading` 文档测试 A 上传拒绝。受限角色只调用标记/完成删除例程，B 账号通过 Storage API 清理一次性对象；清理失败会列出文档 ID 并返回非零状态。旧无参数模式保留。**独立测试项目的 A/B 双向越权与一次性夹具清理已通过真实验收；生产普通用户直接读取跨账号原件的隔离也已按下文完成单份文件实测，生产跨账号处理/删除拒绝仍待验收。**

数据库并发验收使用 [`web/scripts/verify-knowledge-db-concurrency.mjs`](../web/scripts/verify-knowledge-db-concurrency.mjs)，只允许在 `D:\龙虾\Codex\PersonalAgent-KB-Test\web` 运行，只接受测试项目 `personal-agent-quota-test`（固定 Ref `pxfaqcepztzqyqtmbdrf`）。**独立测试项目的只读预检及真实并发写入验收均已通过；此前 `UNKNOWN_FAILURE` 是当时的排查状态。** 本次使用全新专用 C/D 两个测试账号，没有复用 A/B；测试前 C/D 无文档、片段、Storage 原件、上传事件和处理事件。以下配置与命令保留为历史验收及未来重复执行的操作说明；每次重跑仍须使用全新空白账号且不得有其他进程同时使用。账号在测试项目 Auth 中创建并通过该项目登录获取短期 JWT；不要把 JWT、Key、连接 URL 或密码写入仓库、命令参数、日志或清单。测试项目的 Publishable Key、固定 URL、C/D 的 ID/JWT、受限 `knowledge_writer_login` 与仅测试用 `postgres` Transaction Pooler URL、TLS CA PEM 的 Base64 内容，经当前终端的 `KB_DB_TEST_*` 进程环境变量提供，不读取 `.env.local`。两个 URL 必须指向同一测试项目的 `:6543/postgres`；TLS 证书和主机名严格验证。先核对独立 Worktree 和项目身份，再设置变量；禁止复制原开发仓库的生产 `.env.local`。

依次在独立测试 Worktree 的 `web` 目录运行以下命令，正式执行仍需另行人工批准。`--preflight` 只做项目、JWT、角色/权限及 C/D 空白状态查询；`--execute` 需要 `KB_DB_TEST_ACK=I_ACCEPT_MUTATING_ISOLATED_PROJECT`，预检通过后显示预计约 126 条文档、3 个原件、管理员写入范围与事件保留策略，并要求在交互终端输入完整项目名。`--inspect-run` 用清单中的 Run ID 在只读事务中检查精确登记的对象及事件数，不清理、不补写。三个模式都要求指定测试 Worktree；脚本无默认执行模式。

预检按顺序报告固定项目、C/D Auth、管理员与两条 Writer 连接、只读事务、角色和五项函数权限、C/D 文档/片段、Storage、上传/处理事件的阶段 PASS；本次独立测试项目已全部 PASS。失败时只输出当前阶段、最后成功阶段、分类和受控错误码；不会输出原始异常、JWT、连接 URL 或文件内容。`SQL_SCHEMA` 可能表示实际测试数据库对象与仓库迁移不一致，`SQL_PERMISSION` 表示只读查询或函数权限不足；超时/网络故障需单独复核，不能据此推断对象或事务状态。此前的未知错误属于已结束的诊断阶段，不代表当前预检失败。

```powershell
Set-Location 'D:\龙虾\Codex\PersonalAgent-KB-Test\web'
node --use-env-proxy .\scripts\verify-knowledge-db-concurrency.mjs --preflight
node --use-env-proxy .\scripts\verify-knowledge-db-concurrency.mjs --execute
node --use-env-proxy .\scripts\verify-knowledge-db-concurrency.mjs --inspect-run '<Run-ID>'
```

必需变量名为 `KB_DB_TEST_PROJECT_KIND`、`KB_DB_TEST_PROJECT_REF`、`KB_DB_TEST_URL`、`KB_DB_TEST_PUBLISHABLE_KEY`、`KB_DB_TEST_CA_CERT_BASE64`、`KB_DB_TEST_FIXTURE_ADMIN_URL`、`KB_DB_TEST_WRITER_URL`、`KB_DB_TEST_USER_C_ID`、`KB_DB_TEST_USER_D_ID`、`KB_DB_TEST_JWT_C`、`KB_DB_TEST_JWT_D`；仅 `--execute` 额外要求 `KB_DB_TEST_ACK`。`--inspect-run` 只需要项目种类、Ref、管理员 URL 和 CA。真实执行验证双连接争领、过期代次、处理/删除竞态、原件缺失、每 UTC 小时第 21 次上传初始化、第 101 个文档、声明总容量超过 100 MiB、第 61 次处理领取。100 MiB 只验证数据库**声明容量**，不真实上传 100 MiB。管理员仅在隔离测试项目调整本轮文档过期时间及 C/D 本轮当前小时事件时间；事件行保留审计，不自动删除。不能对生产项目使用管理员 URL。

`--execute` 在每次写入前把本轮文档 ID、预期用户、精确 Storage 路径及阶段写入 Git 忽略的 `.kb-acceptance-runs/<Run-ID>.json`。成功时逐项核对归属并清理登记文档/原件；失败、Ctrl+C、超时或响应丢失时停止后续写入、保留清单，不推断事务已回滚或对象已删除。用 `--inspect-run` 检查，人工审查清单中仍存在的精确 ID/路径后决定恢复；**不得按用户 ID 或文件名前缀批量删除**。清理成功也保留清单和上传/处理事件以便审计。每轮使用新的 C/D 账号；若预检发现已有数据，直接退出，不自动清理。独立测试项目 Run ID `ad0ef8cd-f98e-4a79-9f85-3b53816f9788` 已完成清理及只读复核：登记文档和 Storage 对象均不存在，事件行保留。真实验收通过双连接争领、过期代次、处理与删除竞态及限额；100 MiB 仅验证数据库声明容量。该段为独立测试项目的历史验收记录，当前生产上线状态见本节开头及下方里程碑。

A/B 跨账号处理/删除 API 已在独立测试项目验收。生产已完成 TXT/Markdown/PDF 上传解析、片段生成、删除及数据库/Storage 清理；A/B 双向页面列表隔离通过，B 的 `GET /api/knowledge` 实测为 200 和空 `documents`。

**生产只读隔离验收（维护者报告）：**使用 [`web/scripts/verify-knowledge-readonly-production.mjs`](../web/scripts/verify-knowledge-readonly-production.mjs)，在固定生产项目中用 A/B 普通用户会话检查同一份预登记文件。A 直接读取 `knowledge_chunks` 得 1 条，B 查询同一 `document_id` 得 0 条；A 下载原件为 475 字节，B 下载同一路径收到 HTTP 400 且 SDK `error.code` 为 `NoSuchKey`，未取得文件字节。工具再次验证 B 身份，并复核 A 二次下载的大小和 SHA-256 与首次一致，最终为 `READONLY_ACCEPTANCE PASS`。工具仅允许固定文档的表 GET、Storage GET 及认证请求；禁止重定向，限制 Storage 成功响应为 4 MiB、错误响应为 64 KiB，不输出正文或凭据。此结果仅覆盖当次测试文件与 A/B 会话；工具的模拟回归不能代替生产实测，也不能证明跨账号写入拒绝。

维护者通过正常页面删除本次生产测试文件，随后用生产只读 SQL 确认：测试文档、测试片段、测试 Storage 对象、全部知识库文档、全部片段、全部 Storage 对象及孤立 Storage 对象均为 0；内部上传/处理事件可能按设计保留。**生产仍待：**跨账号处理/删除拒绝，Storage 删除失败重试与损坏文件残留清理，以及完整数据库恢复演练；备份与权限快照已准备，但不是恢复演练。用 [`supabase/knowledge_base_readonly_review.sql`](../supabase/knowledge_base_readonly_review.sql) 核对角色 `SUPERUSER`、`BYPASSRLS`、`CREATEROLE`、`CREATEDB`、继承成员关系、数据库/Schema/表/序列/函数及 PUBLIC 有效权限、函数 schema/EXECUTE、表 RLS、Bucket private，以及 **storage.objects 上全部策略**。尤其审查适用于 authenticated 的所有 permissive 策略；它们按 OR 组合，其他名称的宽松策略可能放宽 `knowledge-files` 的访问。只读 SQL 是审查清单，不能自动证明策略互不冲突；独立测试通过也不能替代剩余生产安全与失败恢复场景的验收。

## Personal Memory 数据安全

- Migration：`supabase/migrations/20261007160000_create_memories.sql`。该 Migration 已由项目维护者在 Supabase SQL Editor 执行并确认 RLS 与四条 authenticated ownership policy。
- API 通过现有 Supabase SSR Server Client 与登录 Cookie 工作，服务端从 `getClaims()` 获取 `user_id`；客户端不能提交或修改所有权及数据库管理字段。
- `public.memories` 仅授予 authenticated 读取、受限列插入/更新和删除权限；anon 无表权限。POST 不提交 `source`，数据库默认 `manual`；RLS 是最终行级安全边界。
- API 输入验证内容 1–2000 字符、类别枚举与 1–5 整数重要度；私人响应使用 `private, no-store`。跨用户单条记录访问返回 404，不泄露记录归属。
- 单个真实账号的 GET、POST、PATCH、更新时间 trigger 与 DELETE 已通过；匿名请求已通过拒绝测试。A/B 两个独立真实 Session 的 Memory Context 隔离已通过人工验收；跨账号单条 Memory API 访问的单独复测结果仍应与上下文隔离验收区分。联调中曾出现多次 503 后 PATCH 重试成功，未观察到 403 权限拒绝。

## Agent Personal Memory Context

- `/api/ai/chat` 只接受普通 user/assistant conversation；system prompt、Memory Context 与 user identity 都由服务端生成，客户端不能伪造或指定 Memory。
- Gateway 使用当前请求的 Supabase SSR client 和经验证 claims 查询当前用户的 `content/category/importance`，按 importance 降序、created_at 降序，最多 8 条；RLS 继续作为最终行级边界。
- 格式化后的完整 system instruction 最多 4000 字符，且不会让消息数量超过 20 条或会话与 Memory 合计超过 Gateway 的 16000 字符输入上限。内容用 JSON string quoting 表示为不可信背景数据，不包含数据库 ID、用户 ID 或时间戳。
- Memory 查询无记录时正常对话并返回 `memory.status = none`；检索临时失败时不输出原始错误、不注入 Memory，并以 `unavailable` metadata 继续安全调用。认证失败仍拒绝请求。服务端不记录 Memory 内容、完整 Prompt 或私人资料。
- Auto 路由在 Memory 检索后运行。Privacy 偏好仍只调用本地 Ollama；Memory Context 只传给该本地 Provider，不会因为上下文存在而切换到云端。Auto 仍可按既有策略选择云 Provider。

## AI 智能记忆建议开发与验收

- Agent 页面“智能记忆建议”默认关闭。开启后每次成功聊天回复只针对本轮用户消息发起一次独立提取，回复先显示；关闭、清空任务与组件会话切换会清除未保存候选。额外调用云 Provider 时独立预占一次每日 30 次云额度；上游失败也计，云 fallback 不重复计。Privacy 与 Ollama 不计云额度。
- `POST /api/ai/memory-candidates` 先验证 Supabase claims、同源请求与严格输入边界，再通过共用 `runAiGateway` 走 Router、Provider Registry 和配额。模型只接收单条用户消息及服务端固定提取指令，不接收当前用户其他 Memory 或 AI 回复。输出必须是规定 JSON 结构，最多 3 条，分类限现有枚举；异常返回安全错误，不影响先前聊天。
- 候选只在页面内存，确认前不写数据库。确认按钮调用现有 Memory GET 复查重复，再调用现有 POST；`user_id` 从服务端 Session 取得，仍由 RLS 限制。模型无法指定所有权或 `source`；保存记录沿用现有 `manual` 默认值。本功能无新增 migration，部署前仍须按配额文档审核并部署已有云配额 migration。
- 去重按 NFKC、小写、移除空格与标点比较现有当前用户 Memory 和本轮候选。当前提取查询最多读取 1000 条当前用户记录；超过这个规模、跨标签页并发确认或语义近似表达不能保证去重。疑似 Secret 有额外规则过滤，但模型建议仍必须由用户审核，不应把筛选当作敏感数据识别保证。
- `npm test` 的提取测试全部使用 fake Provider、fake Session 与 fake Memory；不调用真实模型、Supabase 或付费服务。人工验收应先在隔离环境确认配额 SQL 已部署，再分别测试 Ollama/Privacy、OpenRouter/Auto、A/B 账号隔离、候选质量、确认/忽略与配额扣减；本分支自动测试不代表这些真实场景已通过。
- 当前检索为 importance/时间排序，不是 Semantic Search 或 RAG；不自动创建、总结、衰减或提取 Memory。

Ollama `qwen3:8b` 已通过本机 Gateway 真实推理验收。对话文本发送给配置的 Ollama 服务处理，不产生云 API Token 费用。若 Next.js 部署在 Vercel，`127.0.0.1` 指向 Vercel 运行环境，无法访问用户电脑上的 Ollama；需等待后续 Local Connector 方案。

## Task 3 认证验证

- 无 `web/.env.local` 或两个配置为空：`/login`、`/signup` 可访问，显示未配置提示；受保护页面返回登录。
- 填入真实项目的公开配置并重启：测试错误密码、确认密码不一致、注册与邮箱确认、登录、刷新保持登录、五个页面导航、退出以及退出后再次访问受保护页面。
- Supabase Email provider、邮箱确认开关与 Redirect URLs 需在用户的项目控制台设置；应用不管理这些外部配置。
- 密码和 session token 不记录到日志，不存入业务数据库。主要配置采用 `NEXT_PUBLIC_SUPABASE_URL` 与 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`，仅公开 publishable key 可传到浏览器；旧 anon key 仅作为兼容回退。
- 没有真实项目时，不能声称已完成真实邮件发送或实际项目的认证联调。

本阶段已验证无配置的生产页面和登录跳转，并通过临时本地认证测试服务检查密码不一致、Loading/Error、等待确认提示、登录、刷新、页面导航与退出。伪造 session Cookie 被拒绝。测试服务与虚构配置不写入产品代码。真实 Supabase 联调已确认邮箱验证、密码登录、Session Cookie、Proxy 与 Workspace claims 验证；真实账号的刷新、完整导航、退出与重新登录均已由用户确认通过。

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
