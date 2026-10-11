# Architecture

## Implemented — Memory-aware Agent

- Browser → Web：Next.js App Router 提供 Dashboard、Agent、Memory、Knowledge Base 与 Settings UI。
- `/login`、`/signup` 与 `/auth/callback` 提供 Supabase Email / Password 认证基础。
- `@supabase/ssr` 使用 Cookie 会话，`web/proxy.ts` 刷新并通过 `getClaims()` 验证身份；`(workspace)` 服务端布局再次验证后渲染原 UI，URL 不变。
- `POST /api/ai/chat` 与 `GET /api/ai/providers` 是 Next.js 服务端 Route Handler，均通过 Supabase `getClaims()` 验证身份。
- `web/lib/ai/` 提供统一 Provider 接口；OpenAI 使用 Responses API，DeepSeek 与 OpenRouter 使用兼容的 Chat Completions API，Gemini 使用 Google Gen AI SDK，Ollama 使用本地 `/api/chat` HTTP API。云模型密钥与 Ollama 地址/模型只在服务端读取。
- Ollama 默认使用 `http://127.0.0.1:11434` 与 `qwen3:8b`，无云 API Key；Gateway 通过非流式请求取得模型文本，保留统一响应格式。云 Provider 与本地 Provider 可共存。
- Chat Gateway 对消息数、单条与总输入长度、请求体大小、Provider 超时和输出长度设限，并将上游错误转换为固定错误码。
- `/agent` 默认使用确定性 Auto 路由，可选显式 Provider 与 Privacy 仅本地模式。Ollama 使用短超时 `/api/tags` 检查可用性；云 Provider 只显示已配置与健康未知，不发起健康探测模型调用。
- Auto 本地可用时优先 Ollama；本地不可用时按 OpenRouter、OpenAI、DeepSeek、Gemini 的固定顺序考虑已配置的云 Provider。最多调用两个候选，且仅在上游错误或超时后 fallback；鉴权、请求校验、限流错误不会触发 fallback。显式 Provider 永不切换。Privacy 模式只尝试本地 Ollama，模型不可用时返回明确错误，不向云端发送消息或 Personal Memory。
- 云端 Provider 构造成功后、实际调用前，Gateway 通过当前 authenticated SSR Client 调用 `reserve_cloud_ai_quota()`。同一请求仅预占一次；本地 Ollama、Privacy、认证或输入失败不调用该 RPC。云 Provider 间 fallback 复用已预占额度。额度耗尽或配额存储不可用时，云端调用 fail-closed。
- `POST /api/ai/memory-candidates` 是独立的认证请求，只分析本轮用户消息。它与聊天路由共用 `runAiGateway`，因此沿用相同的 Router、Registry、超时、fallback、安全错误与云额度预占；提取请求若调用云端，会在普通聊天之外独立消耗一次额度。Privacy 仍只有 Ollama 候选。
- 提取模型的 JSON 输出经严格字段、分类、条数与长度校验；当前用户的 Memory 仅在模型返回后用于规范化去重，不作为提取模型输入。候选只存在页面内存；用户点击确认才调用现有 `POST /api/memories`，由当前 authenticated Session 和 RLS 限定所有权。无新数据库表或 RLS 变更。
- Agent Chat 通过认证后的 `POST /api/ai/chat` 发送消息。最近最多 20 条消息作为多轮上下文，只保存在前端内存，刷新后清空；不建立会话数据库。
- AI Gateway 在模型路由前使用当前 SSR Session 的 Supabase Client 检索 Personal Memory，RLS 是最终所有权边界；当前用户 ID 仅由已验证 claims 获得，客户端不能传入 Memory、用户 ID 或 system prompt。
- Memory 按 importance 降序、created_at 降序检索，最多 8 条；模型上下文不超过 4000 字符，并受 Gateway 16000 字符总输入与消息数预算约束。只格式化 category、importance、content，不发送记录 ID、user_id 或时间戳。
- Memory Context 作为服务端 system/developer instruction 参数传给 Provider；明确将保存内容视为不可信数据，禁止其覆盖系统、安全、认证、隐私或路由规则。Memory 查询失败时不记录原始错误或内容，聊天可继续且 metadata 显示 unavailable；认证失败仍返回 AUTH_REQUIRED。
- Agent Timeline 展示 Received、Validating、Retrieving Memory、Routing、Generating、Completed；响应仅返回 memory status/count，不返回 Memory 内容或数据库标识。
- 缺少或无效的公开配置时不创建客户端，认证页显示提示，受保护页面跳转登录；无开发绕过入口。
- Dashboard 仍展示演示数据；`/memory` 使用真实 Supabase 数据。`/knowledge` 的文件上传、元数据和有序正文片段已在独立测试项目及生产环境验证；生产跨账号直接读取片段/原件与异常恢复仍待验收。Agent 页面是真实 Chat UI，但不执行 Agent Planning 或工具。
- Personal Context Layer 当前实现：Authenticated User → Personal Memory UI → Next.js Memory API → Supabase SSR Session → `public.memories` → RLS。API 从已验证 claims 获取用户 ID；请求不接受客户端指定 `user_id`；数据库仅授予 authenticated 必需的 SELECT、受限列 INSERT/UPDATE 与 DELETE 权限。
- Memory API 提供 `GET/POST /api/memories` 和 `GET/PATCH/DELETE /api/memories/[id]`，强制 private/no-store 响应。SQL 约束类别、重要度和内容长度；POST 省略 `source`，由数据库 `DEFAULT 'manual'` 填充；更新时间由 trigger 维护。
- 记忆所有权由 SELECT、INSERT、UPDATE、DELETE 四条 authenticated RLS policy 保障。按用户过滤是额外防护，不替代 RLS；跨用户单条访问以 404 安全失败。
- 知识库路径：Browser 以当前登录态直传私有 `knowledge-files` Bucket → 认证的 `POST /api/knowledge/[id]/process` 读取并校验原件 → 私有数据库例程提交 `public.knowledge_documents` 与 `public.knowledge_chunks`。初始化和列表由 `GET/POST /api/knowledge` 提供，删除由 `DELETE /api/knowledge/[id]` 提供。服务端从 `getClaims()` 获得用户 ID，不接受客户端所有权或 Storage 路径。文件请求不经过 Vercel Function；处理函数只收文档 ID。
- 两张知识库表均启用 RLS，普通角色只能插入自己的待上传元数据和读取自己的记录。五个 SECURITY DEFINER 状态例程位于未暴露的 `knowledge_private` Schema，authenticated 无 EXECUTE 权限；仅独立的 `knowledge_writer_login` 服务端数据库角色继承执行权限。Next.js 先验证用户 claims，再把该用户 ID 传给函数；函数按 `(user_id,document_id)` 与 processing generation 检查。Storage 的 INSERT/SELECT/DELETE policy 限制当前用户记录的生成路径，Bucket private，限 4 MiB 和三种 MIME。迁移、角色、RLS 和 Storage 隔离已在独立测试项目验收；生产迁移和 Writer 已部署并完成权限核验，生产 A/B 页面及 API 列表隔离、指定测试文档的普通用户直接跨账号片段与原件只读隔离已通过。跨账号处理/删除拒绝仍待生产验收。
- 插入 trigger 在同用户 advisory lock 下限制 100 个文档、100 MiB、每 UTC 小时 20 次初始化；领取处理时限制每小时 60 次。领取要求原始 Storage 对象存在，增加代次；完成/失败须匹配代次。删除使代次失效，Storage 成功删除后才删除元数据和片段。确定性解析失败尝试清理原件；临时失败保留原件并可重试。跨 Storage 与 PostgreSQL 没有单一原子事务，账号整体删除后的旧对象清理仍需独立运维方案。
- 处理流程解析 PDF 文字层、UTF-8 TXT 和 Markdown 正文，再拆分有序片段；B1 分支已实现 `POST /api/knowledge/search` 基础关键词检索，可选 `documentId` 精确过滤，用登录用户的 SSR Supabase Client 查询 RLS 保护的 ready 文档片段，页面只展示文件名与有限文字摘录。不下载 Storage 原件、不调用模型；当前未实现 OCR、Embedding、向量检索或完整 RAG。独立测试项目已验证指定文档的 A/B 双向搜索隔离、ready 命中及保留片段时 deleting 状态返回空结果；其他非 ready 状态和不带 `documentId` 的真实宽范围搜索未实测，生产 B1 尚未部署或验收。独立测试项目另已验证 TXT/Markdown/PDF 上传解析、A/B 双向隔离、双连接争领、过期代次、删除竞态及限额；100 MiB 只验证数据库声明容量，不代表上传了 100 MiB 文件。生产三种格式上传解析、片段生成、删除及 Storage 清理已通过；Storage 删除失败、损坏文件残留和数据库恢复演练仍待验收。
- Migration 已由项目维护者在 Supabase 执行并确认 RLS 与四条 Policy。真实登录态使用最小列权限完成 GET 200、POST 201、PATCH 200 与 DELETE 204；响应中的 source 为 `manual`，更新时间 trigger 产生新时间。匿名五种 API 操作均返回 401 `AUTH_REQUIRED`。A/B 双账号的 AI Memory Context 隔离已有人工验收；跨账号单条 Memory API 访问的单独复测不与该结果混同。
- 联调期间多次 PATCH 曾返回 503 `MEMORY_SERVICE_ERROR`，重试后 PATCH 返回 200；未观察到权限拒绝 403。该间歇性服务错误应在后续联调中继续留意。
- `web/` 使用 TypeScript 与 Tailwind CSS，提供 lint、类型检查与生产构建脚本。
- `server/`、`connector/` 仅包含占位说明，不提供服务或 API。
- `.env.example` 提供无密钥配置示例及 Ollama 本地默认值；真实环境配置被 Git 忽略。

Agent Chat 通过认证后的 Gateway 调用 Auto 路由或显式选择的 Provider。OpenRouter 是云 Provider，服务端使用 `OPENROUTER_API_KEY` 与默认模型 `openrouter/free`；本地及 Vercel 真实调用已有阶段性人工验收。默认本地 Ollama 推理使用 `qwen3:8b`，由配置的 Ollama 服务处理，不产生云 API Token 费用；对话状态只保存在浏览器页面内存。OpenAI、DeepSeek 尚无真实成功验收记录，Gemini 仍受上游权限限制。部署在 Vercel 时，`127.0.0.1` 指 Vercel 自身，不能访问用户电脑上的 Ollama；配置 OpenRouter 后，Auto 可在本地 Ollama 不可用时尝试该云 Provider。Windows Local Connector 尚未实现。

```text
Browser → Agent Chat (Next.js) → Next.js AI Gateway → Rule-based Model Router ┬→ DB quota reservation → OpenRouter / OpenAI / DeepSeek / Gemini
                                                                               └→ Ollama (local model)
                    ↑
              Supabase Auth
```

## Planned — 目标架构

```text
Browser
  → Web (Next.js)
    → API (FastAPI)
      → Personal Agent
        → Models / Memory / RAG / Tools
        → Local Connector (Windows)
```

未来组件职责：

| 组件 | 规划职责 | 当前状态 |
| --- | --- | --- |
| Browser / Web | 用户交互与结果展示 | Agent Chat 调用 Gateway；Personal Memory 为真实 CRUD；Dashboard 仍含演示数据；Knowledge 文件列表与上传已在生产运行，部分安全与异常恢复待验收 |
| API | 请求校验、认证、服务端配置边界 | Next.js AI Gateway 已实现；独立 FastAPI 服务 Planned |
| Personal Agent | 组织任务、协调模型和工具 | Planned |
| Models / Model Router | 调用云模型或本地模型 | OpenRouter、OpenAI、DeepSeek、Gemini、Ollama 显式选择与规则 Auto Router 已实现；OpenRouter 上游真实调用已阶段性验收，智能模型评估/质量路由 Planned |
| Memory / RAG | 个人记忆与知识检索 | Manual Memory CRUD/RLS、确定性服务端 Memory Retrieval 与上下文注入、用户确认的智能记忆候选已实现；Embedding、Semantic Search 与 Vector RAG Planned |
| Tools | 可授权的外部与本地操作 | Planned |
| Supabase | 数据持久化、身份与存储支持 | Auth 与 `public.memories` 的用户隔离手动 CRUD 已实现；知识库表、私有 Storage 与受限角色已在独立测试项目及生产部署核验，生产跨账号直接读取等安全测试待完成；`public.ai_daily_usage` 迁移状态另行核实 |
| Local Connector | 连接用户设备上的 Ollama、本地文件与受控命令执行 | Planned，仅目录占位；当前 Ollama 仅能由可访问其服务的 Next.js 服务端调用 |

Supabase 用于 Web 认证与 Personal Memory 存储。Memory API 使用现有 SSR Server Client 和经验证的 claims，不建立第二套 Auth 或 service_role 通道。FastAPI 仍是未来高级 Agent / Python Tools / RAG 的规划，`server/` 保留占位。认证 Cookie 由官方 SDK 管理，不建立自研 Session 系统。`getSession()` 中未经验证的用户字段不用于服务端授权。

## Personal Context Layer

**Implemented:** Authenticated User → Session-scoped Memory Retrieval → Safe Context → AI Gateway → Selected Provider。用户可以手动 CRUD 自己的记忆；Gateway 使用同一 authenticated SSR client 查询当前用户记录，额外按 claims 用户 ID 过滤，同时由 RLS 执行最终隔离。检索最多 8 条，优先高 importance、再优先较新记录，Context 有 4000 字符硬上限并受对话剩余输入预算约束。Memory 缺失时不注入上下文且正常聊天；数据库临时失败时 fail-soft 并返回 `memory.status = unavailable`。

**Planned:** 未经确认的自动保存、Embedding、Semantic Search、Vector Database、Vector RAG、记忆总结与衰减均未实现。智能记忆候选需要用户主动开启并确认保存；当前确定性检索不是 RAG。

## 配置边界

私密凭据通过服务端环境变量提供，不能硬编码或放入浏览器公开配置。环境示例只保留变量名及空值，不包含数据库密码、Supabase Secret 或机器绝对路径。

本地连接器将需要明确授权与权限控制；当前不实现这些操作。

## 调用保护边界

- 所有 AI 调用要求 Supabase 登录，并保留请求体、消息数、单条/总输入、输出长度与超时限制。
- Chat 与独立候选提取共用从请求入口起算的 27 秒 Deadline，两条 Route Handler 均声明 30 秒上限；各阶段共享剩余时间。显式 Provider 单次上限 25 秒，Auto 单次上限 12 秒，首候选为可用后继保留 4 秒，剩余不足 2 秒不启动云端调用。客户端取消与总 Deadline 通过 AbortSignal 传到健康检查、Memory 查询、云配额和 Provider。无法取消的底层 SDK 可能继续执行，但迟到结果不得写入响应。
- AI 路由最多输出一条允许字段限定的阶段耗时日志；记录随机请求标识、阶段时长、Provider、尝试数、Memory 失败粗类别与安全错误码，不记录私密请求内容或身份凭据。Memory 可选查询维持 2 秒 fail-soft，Auth 失败仍单独拒绝。候选提取仅在当前 `qwen3:8b` 模型使用 `think:false`，普通聊天参数不变。
- Auto 候选顺序固定为：可用 Ollama，然后按 OpenRouter、OpenAI、DeepSeek、Gemini；最多两次调用。仅 `PROVIDER_ERROR` 与 `TIMEOUT` 允许切换。
- Auto 或显式云 Provider 请求会将当前登录用户的受限 Memory Context 交给最终调用的云服务；Privacy 只允许本地 Ollama。Memory 仍由当前 SSR Session 和 RLS 隔离，响应不返回完整内容，服务端不记录完整 Memory。
- Privacy 偏好只调用已确认可用的 Ollama；没有本地模型时立即拒绝，不发送到云端。云端状态 `unknown` 仅表示没有做健康探测，不代表服务可用。
- `public.ai_daily_usage` 以 `(user_id, usage_date)` 为主键，固定每 UTC 日期 30 次。`reserve_cloud_ai_quota()` 在数据库侧使用 `auth.uid()` 与条件 UPSERT 原子预占；表对 `anon` 和 `authenticated` 无直接权限、启用 RLS 且无开放策略。函数无用户 ID、上限或退款参数；只授权 `authenticated` 执行。跨 Vercel 实例共享同一数据库计数。
- 预占成功后无退款：云端调用成功或失败均消耗一次；云端 fallback 不重复预占。计数是云端请求次数，不是 token 或真实费用预算。迁移尚待人工审查、部署和真实 PostgreSQL 并发验收；上线配额 Web 代码前须先部署迁移。
- Vercel 中的 `localhost` / `127.0.0.1` 指云端运行环境，不能连接用户电脑。访问用户设备上的模型或文件需要未来的 Local Connector；本阶段没有实现该连接器。
