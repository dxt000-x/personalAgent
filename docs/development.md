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
- AI Auto Router 采用固定规则，不执行模型评估：本地 Ollama 可用时优先；否则按 OpenRouter、OpenAI、DeepSeek、Gemini 考虑最多两个已配置候选。只有 Provider 错误或超时可 fallback；认证、输入校验和限流错误不得 fallback。显式选择 Provider 不切换。
- Privacy 模式只允许本地 Ollama；不可用时要清楚失败，不得尝试云 Provider。Provider 配置与可用性是独立字段；云 Provider 未执行真实调用前健康状态保持 unknown。
- OpenRouter 使用服务端 `OPENROUTER_API_KEY`，默认 `OPENROUTER_MODEL=openrouter/free`。显式选择或 Auto 路由到 OpenRouter 时，当前用户的受限 Memory Context 会发送到该云服务；Privacy 下不得发送。不要将 API Key、完整 Memory、Token 或 Cookie 写入日志。
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

Dashboard 中的用户、任务与项目进度仍为演示示例。Knowledge Base 文件列表已改为真实 API/Storage 流程，迁移与线上联调待人工验收。Personal Memory 已改为 Supabase 手动 CRUD；Agent 在服务端读取当前用户的有限记忆并作为不可信背景上下文交给所选 Provider。智能记忆建议需主动开启，AI 只生成候选，不自动创建记忆。Agent Workspace 已连接 AI Gateway，Timeline 显示真实请求阶段。当前对话保存在前端内存，刷新后清空；不实现 RAG、Agent Planning、Tool Calling 或 Local Connector。

## Knowledge Base 文件接入与验收

迁移文件：[`supabase/migrations/20261009120000_create_knowledge_base.sql`](../supabase/migrations/20261009120000_create_knowledge_base.sql)。先在隔离 Supabase 项目人工审查并执行，再核对 `knowledge_documents` / `knowledge_chunks` 的 RLS、Storage 所有权策略、私有 Bucket 限制、五个 `knowledge_private` 例程的 EXECUTE 权限与真实跨用户隔离。当前迁移**尚未执行**。它同时创建 Bucket；若已有同名 Bucket 但配置不符会回滚。迁移文件仍沿用首轮尚未部署的文件名；若某环境已执行旧版本，必须另写增量迁移，不能重复执行或假设当前版本已生效。

**可信解析结果的权限边界：** Browser 与 SSR Supabase client 共用 authenticated JWT，所以任何授给 authenticated 的完成 RPC 都可被用户直接调用。现在五个 SECURITY DEFINER 例程均在非 Data API Schema `knowledge_private`，并撤销 PUBLIC、anon、authenticated 的 EXECUTE。迁移只创建 `knowledge_writer` NOLOGIN 权限组；维护者审查后在隔离项目手动创建独立 `knowledge_writer_login` 登录角色、设置独立强密码，并授予该组：

```sql
create role knowledge_writer_login with login password '<独立生成的强密码>';
grant knowledge_writer to knowledge_writer_login;
grant connect on database postgres to knowledge_writer_login;
-- 在隔离项目核对：
select has_function_privilege('authenticated', 'knowledge_private.complete_knowledge_document(uuid,uuid,integer,jsonb)', 'EXECUTE'); -- false
select has_function_privilege('knowledge_writer_login', 'knowledge_private.complete_knowledge_document(uuid,uuid,integer,jsonb)', 'EXECUTE'); -- true
```

从 Supabase Connect 面板复制该自定义角色的 TLS 连接主机/端口，以角色 `knowledge_writer_login` 建立仅供 Next.js 服务端使用的 `KNOWLEDGE_DB_URL`。共享池用户名形式为 `knowledge_writer_login.<project-ref>`；凭据只进环境配置，不放进 Git，不打印 URL。应用显式拒绝 `postgres` 等其他用户名，并验证 TLS 证书。生产 Vercel 配置**本分支未修改**；没有此配置时处理/删除安全失败，不得上线宣称知识库可用。此方案不使用 `service_role`，但数据库自定义角色仍可能继承其他对象对 `PUBLIC` 的默认权限，部署前需单独审计数据库有效权限及凭据轮换流程；不能宣称它在整个数据库只有这五项权限。密钥泄露时攻击者可能调用私有例程并伪造用户参数，因此仅部署在可信服务端。

状态机：`uploading` 只在 Storage 原件存在时可领取；`failed/temporary` 可由页面“重试处理”重新领取；确定性非法文件为 `failed/invalid_file`，只可删除并重新上传。领取在数据库行锁下返回递增 generation，10 分钟过期后可重领；旧 generation 的完成/失败均被拒绝。`deleting` 使代次失效，先删除 Storage，再确认对象不存在并级联删除文档/片段；删除失败保留记录供重试。非法文件清理失败保留 `failed` 元数据及原件供删除；临时失败保留原件。Storage/数据库间没有全局事务，孤儿对象巡检仍是运维事项。

资源约束由数据库 trigger 执行，即使 authenticated 直接插入元数据也生效：每用户最多 100 个文档、累计声明大小 100 MiB、每 UTC 小时 20 次初始化（即使随后删除也计数）。领取处理另限每用户每 UTC 小时 60 次，单文件仍为 4 MiB。计数是请求防滥用边界，不是物理存储或成本结算保证；真实 Storage 字节仍由服务端处理时核对。

[Vercel Function 请求体上限为 4.5 MB](https://vercel.com/docs/functions/limitations)，因此 `POST /api/knowledge` 只接收最多 4 KiB 的初始化 JSON，文件由浏览器的 Supabase 客户端直传私有 Bucket；4 MiB 也低于 [Supabase 标准上传建议的 6 MB 阈值](https://supabase.com/docs/guides/storage/uploads/standard-uploads)。Bucket MIME/大小、用户路径 RLS 是入口防线。服务端下载原件后再次核对大小、扩展名对应格式、PDF 头与解析结果、UTF-8 和明显二进制特征，拒绝空正文、超长正文、超过 50 页的 PDF 或超过 200 段的文档。PDF 使用 `pdfjs-dist` 提取文字；无 OCR。Markdown 作为原文保存，不执行 HTML。

自动化测试使用内存中的假数据库、Storage 和客户端；SQL 静态测试只约束迁移文本。它们不访问真实 Supabase，也不证明实际 GRANT、RLS、触发器并发或 Storage 事务。在**隔离测试项目**应用迁移并准备 A/B 两个测试账号、各自文档与 A 的未上传原件记录后，按 [`web/scripts/verify-knowledge-security.mjs`](../web/scripts/verify-knowledge-security.mjs) 注释设置 `KB_TEST_*` 进程变量，执行 `node scripts/verify-knowledge-security.mjs`。脚本拒绝非 `isolated-test-project` 标志，检查两账号直接调用五个公开/私有 RPC 均被拒绝，以及文档/片段跨用户不可见。所有测试凭据应是短期测试值，不得写入文档或提交。

还需在同一隔离项目人工实测：A 仅初始化未上传原件，处理返回 `FILE_NOT_UPLOADED` 且不进入 `processing`；A/B 不能调用对方处理/删除 API 或下载原件；100 个文档、累计字节、UTC 小时边界和第 21 次初始化/第 61 次处理的拒绝；同时领取同一文档仅一项成功；将第一代次标记超时后第二次领取，第一代次完成被拒绝；处理时删除后旧代次不能提交；Storage 删除失败后重试；损坏文件残留清理。用 [`supabase/knowledge_base_readonly_review.sql`](../supabase/knowledge_base_readonly_review.sql) 核对函数 schema、`prosecdef`、EXECUTE、表 RLS、Bucket private 和 Storage policy。达到 100 文档或小时边界的测试可能需要隔离项目预置测试数据或跨多个小时执行；不可通过修改生产数据验证。未执行这些真实测试前一律标为**待实测**，不得把 mock 通过写成 Supabase 安全验收通过。

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
