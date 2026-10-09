# Personal AI Assistant — 开发交接

更新日期：2026-10-09（Asia/Shanghai）。本文件用于新 Codex 对话接续开发；先核对实际仓库、Git 状态和用户指定任务，再开始修改。

## 项目目标与技术栈

面向大学生和年轻职场人的 Personal AI Workspace。目标是逐步结合个人记忆、知识与受控工具完成任务。当前实现认证、多模型文本对话、确定性路由、手动 Personal Memory 与需用户确认的智能记忆候选；尚未实现自主 Agent。

- Web：Next.js 16.3.8 / App Router、React、TypeScript、Tailwind CSS。
- Auth / Memory：Supabase Auth、`@supabase/ssr`、Supabase Postgres 与 RLS。
- 模型：OpenAI JavaScript SDK、Google Gen AI SDK、Ollama HTTP API。
- 工程：npm 锁文件、ESLint、TypeScript 检查、Next.js production build。
- Windows：根目录 setup/start 的 `.bat` 与 `.ps1` 启动脚本。
- `server/` 与 `connector/` 为占位目录；独立 FastAPI 和 Windows Local Connector 尚未实现。

## 仓库与交接状态

- 当前仓库由用户确认沿用原位置；不要自动迁移或复制项目。原请求中的新路径不存在，启动新对话时应绑定当前实际仓库。
- 当前知识库接入任务 branch：`feat/knowledge-base-ingestion`；任务开始时 HEAD 为 `8b9cd90`，工作区 clean。历史智能记忆候选任务 branch 为 `feat/ai-memory-extraction`，当时基线是 `a1a13ee`。本轮未联网核对远端最新 main。
- 先前 Agent 输入交互任务 branch：`feat/agent-enter-to-send`；该任务已合并到当前基线。
- 先前稳定性任务 branch 为 `test/ai-gateway-regression`；当时 HEAD 与本地 `main`、`origin/main` 均为 `ac1e55a`。
- OpenRouter 合并基线：`2874015`，`Merge pull request #21 from dxt000-x/feat/openrouter-provider`。
- origin：`https://github.com/dxt000-x/personalAgent.git`。
- OpenRouter 功能提交：`7fdf648`（Provider）、`91e176c`（Auto 云候选）、`befa6c5`（文档）。已合并至本地 main。
- 历史稳定性任务只新增自动测试、测试依赖与文档；本分支为智能记忆候选提取，复用现有 Gateway 规则。
- 任务开始时尝试 `git ls-remote` 核对远端 main，但本机 Git 返回 `SEC_E_NO_CREDENTIALS`；因此只确认与本地 main 和本地 origin/main 一致，不声称已核对 GitHub 最新状态。

## 当前架构

```text
Browser / Agent Workspace
  → Next.js authenticated AI Gateway
    → Supabase SSR Session / getClaims()
    → 当前用户 Personal Memory Retrieval（authenticated client + RLS）
    → 有限、不可信背景 Context
    → 确定性 Model Router 或显式 Provider
      → OpenRouter / OpenAI / DeepSeek / Gemini / Ollama
```

关键入口：

- `web/app/api/ai/chat/route.ts`：认证、请求校验、Memory、路由、模型调用与安全错误响应。
- `web/app/api/ai/providers/route.ts`：认证后的配置与可用性查询。
- `web/lib/ai/`：统一类型、Provider、Registry、Router、输入限制和错误类型。
- `web/lib/ai/quota.ts`、`supabase/migrations/20261008190000_create_ai_daily_usage.sql`：云 Provider 调用前的 authenticated RPC 预占与 PostgreSQL 持久化每日计数；迁移尚待用户审查和部署。
- `web/components/agent-workspace.tsx`：Agent 聊天输入与发送；Enter 发送、Shift+Enter 换行，IME 组合输入和 keyCode 229 不触发发送。键盘与按钮共用提交逻辑，发送中的同步 ref 防止重复请求。
- `web/lib/supabase/`、`web/proxy.ts`、workspace layout：官方 SSR Cookie 会话与路由保护。
- `web/app/api/memories/`、`web/lib/memories/`：当前用户 Memory CRUD 与受限 Context。
- `supabase/migrations/20261007160000_create_memories.sql`：表、最小列权限、RLS、索引和更新时间 trigger。

## 已实现与真实验收

以下真实结果来自本对话已完成的浏览器验收；本次交接检查未重复发送云模型请求，也未重新运行双用户数据库验收。

- Supabase：登录进入 Dashboard、刷新保留 Session、所有 Workspace 导航、退出、匿名受保护页面跳登录、重新登录，用户确认六个场景全部通过。
- Memory：真实手动 Add/Edit/Delete、`source = manual`、自动更新时间和 UI 更新已完成验收。数据库通过 authenticated Session 访问，不使用 service_role。
- Memory Context：User A 的 Privacy 与 Auto 对话使用 2 条当前用户 Memory；User B 的独立 Session 使用自己的 1 条 Memory，没有出现 A 的项目/重点信息。用户确认隔离通过。
- OpenRouter：显式 Provider 真实调用成功；`openrouter/free` 返回实际免费模型。A/B 的云端 Memory Context 隔离已由用户确认。
- Privacy：OpenRouter 已配置时仍选择本地 Ollama `qwen3:8b`，真实回复成功。
- Auto 云切换：仅在独立 3032 测试进程临时将 Ollama 地址设为不可达端口，不修改环境文件或 Router；UI 确认 Ollama unavailable、OpenRouter configured。真实返回 `Auto Cloud 联调成功`，最终 Provider `openrouter`，实际模型 `nvidia/nemotron-3.5-lightning:free`。
- Auto 云切换 HTTP 200 的证据为 UI 成功响应及 Gateway 成功分支固定返回 200；当次未保存原始 HTTP 网络记录。不可用的 Ollama 未被调用，OpenRouter 作为首个可用候选成功，无 Provider 错误后的额外重试。
- 恢复：移除测试进程覆盖，Ollama `/api/tags` HTTP 200，`qwen3:8b` 仍存在；正常 Auto 再次选择 Ollama 并回复 `Auto Local 联调成功`。
- 匿名 AI 接口：上一轮真实请求中 GET providers 与 POST chat 均返回 401 `AUTH_REQUIRED`。
- 云端配额代码已添加，但 SQL 尚未执行；当前没有真实数据库并发或部署后的云调用验收，不将自动测试描述为已完成数据库原子性验收。
- Dashboard 仍含明确的演示数据。Knowledge Base 上传、解析、列表和删除已接入代码，但新 migration 与私有 Storage 尚待人工部署和真实账号验收；知识检索未接入。Settings 部分为 UI 设置或占位。

## 各 Provider 状态

| Provider | 实现 | 真实验收状态 |
| --- | --- | --- |
| OpenRouter | OpenAI SDK + `https://openrouter.ai/api/v1`，非流式 Chat Completions；集中默认 `openrouter/free` | 显式、Memory、A/B 隔离、Auto 本地不可用后云切换已通过 |
| Ollama | `/api/chat`，`/api/tags` 健康检查；默认 `qwen3:8b` | 显式、Auto、Privacy、Memory 与恢复本地优先已通过 |
| OpenAI | 官方 SDK Responses API；集中默认 `gpt-5-mini` | 接口已实现；本对话没有真实上游成功验收记录 |
| DeepSeek | OpenAI SDK 兼容 Chat Completions；集中默认 `deepseek-flash` | 接口已实现；本对话没有真实上游成功验收记录 |
| Gemini | `@google/genai`；集中默认 `gemini-3.8-flash` | 接口保留；真实调用曾受上游权限限制，尚未成功验收 |

默认模型位于 `web/lib/ai/provider-registry.ts`，可用服务端环境变量覆盖。表中的模型是代码默认或历史实测值，不保证上游长期可用；免费模型实际选择可能变化。

统一接口为 `AIProvider.generate(messages, signal, systemInstruction?)`；返回 `text/provider/model` 与可选 usage。UI 不依赖各家原始 SDK 响应。Registry 对云 Provider 只报告 configured 与 availability unknown，不把“配置了 Key”当作调用成功。

## Router、输入与错误边界

- Auto：可用 Ollama 优先；云候选依次 OpenRouter、OpenAI、DeepSeek、Gemini。最多两个候选。
- 仅 `PROVIDER_ERROR`、`TIMEOUT` 可触发第二候选；限流、认证与输入错误不触发切换。显式 Provider 不 fallback。
- 每个 authenticated Gateway 请求首次尝试云 Provider 前通过同一 SSR Client 预占 1 次云配额；固定每用户每 UTC 日期 30 次。云端成功或失败都消耗一次，云端 fallback 不重复预占；Ollama、Privacy、认证/输入失败不计。额度耗尽返回 `CLOUD_QUOTA_EXCEEDED` 429，配额不可用返回 `QUOTA_UNAVAILABLE` 503，均不调用云端。
- Privacy 仅允许本地 Ollama；本地 unavailable 时返回 `PRIVACY_PROVIDER_UNAVAILABLE`，不调用云 Provider。显式云 Provider 与 privacy 组合被输入校验拒绝。
- 请求体最多 64 KiB，最多 20 条 user/assistant 消息，单条 4000 字符，总计 16000 字符；最后一条必须是 user。
- 输出最多 1024 token，并将返回文本截断到 12000 字符。
- 两条 AI POST 路由各声明 30 秒执行上限，从请求入口实行 27 秒共享 Deadline；显式 Provider 单次上限 25 秒，Auto 每候选单次上限 12 秒且受总剩余时间约束。首个 Auto 候选尽量为第二候选留 4 秒，剩余不足 2 秒不新启云端调用；Ollama 健康检查 1.5 秒。使用 OpenAI SDK 的 Provider 将 `maxRetries` 设为 0；客户端/总截止 AbortSignal 传入可取消 I/O。
- 错误码：AUTH_REQUIRED 401、INVALID_REQUEST 400（请求体超限可为 413）、PROVIDER_NOT_CONFIGURED 503、PRIVACY_PROVIDER_UNAVAILABLE 503、PROVIDER_ERROR 502、RATE_LIMITED 429、CLOUD_QUOTA_EXCEEDED 429、QUOTA_UNAVAILABLE 503、TIMEOUT 504。
- 上游 429 映射 RATE_LIMITED；超时/中止映射 TIMEOUT；其余上游错误用固定 PROVIDER_ERROR。客户端不会收到 SDK stack 或原始错误。
- 本次对错误映射和超时进行代码审查；未重新执行真实 429、强制超时或 SDK 故障注入，不能描述成这些故障场景均已实测。

Memory 最多 8 条，按 importance 与创建时间排序；上下文最多 4000 字符，并共享总输入预算。只发送 content/category/importance，不发送数据库标识。查询超时 2 秒，失败时以 unavailable metadata 安全继续聊天。保存内容作为不可信背景，不允许覆盖隐私、认证或路由规则。

## 密钥与数据安全

- 云 Key 只用 `OPENROUTER_API_KEY`、`OPENAI_API_KEY`、`DEEPSEEK_API_KEY`、`GEMINI_API_KEY` 等服务端变量，禁止 `NEXT_PUBLIC_` 前缀。
- Supabase 浏览器配置只使用 URL 与 publishable key；兼容旧 anon key。禁止 service_role 或数据库密码进入浏览器代码。
- `.env` / `.env.*` 被忽略，只有 `.env.example` 可提交。`web/.env.local`、node_modules、`.next` 本次确认未跟踪。
- 本次对已跟踪文件的 OpenRouter Key 特征及非空环境赋值做聚焦扫描，未发现真实 Key；未读取或输出本地 Key。本次未做完整 Git 历史密钥审计。
- API providers 只返回 id/type/configured/availability/model；AI 响应不返回密钥、Cookie、Token、完整 Memory 或内部 Prompt。
- 已审查 AI/Memory 源码没有记录完整 Memory/Prompt 的日志调用。
- 云调用会发送当前会话与受限个人上下文至最终云 Provider；Privacy 才是仅本地模型处理边界。
- 云配额表对 `anon`、`authenticated` 无直接权限，启用 RLS 且无开放策略；无 service_role 用于普通请求。无参数 `SECURITY DEFINER` RPC 从 `auth.uid()` 获得用户，固定空 search_path、固定上限 30，仅 authenticated 可执行。迁移等待人工 SQL 审查。

## 工程验证（本次交接）

| 检查 | 结果 |
| --- | --- |
| `npm run lint` | 通过，exit 0 |
| `npm run typecheck` | 通过，exit 0 |
| `npm run build` | 通过，exit 0；首次沙箱运行因 spawn EPERM 失败，授权环境重跑成功 |
| 自动化回归 | 新增 Vitest；5 个测试文件、47 个测试用例全部通过；只使用 fake Provider、配置、认证与 Memory 替身，不访问真实模型或 Supabase |
| Agent 输入交互 | 新增 jsdom + React Testing Library 组件测试；合计 6 个测试文件、53 个测试用例通过，覆盖 Enter、Shift+Enter、IME、空白输入、请求中重复发送与原按钮 |
| 云配额自动测试 | 合计 7 个测试文件、75 个测试用例通过；fake RPC 验证 Gateway/错误边界，不代表真实 PostgreSQL 并发验收 |
| Git 稳定性任务起始状态 | test/ai-gateway-regression，clean；HEAD 与本地 main、origin/main 均为 ac1e55a |
| 稳定性任务范围 | 测试与文档；正式业务代码未修改 |

自动化基线：在 `web/` 使用 `npm test` 单次运行退出，`npm run test:watch` 用于本地开发。测试文件覆盖 Router 顺序/上限及 Provider 分类、Privacy 云调用为零、全部显式 Provider 不 fallback、Auto 可切换与禁止切换的错误类别、请求输入边界、公开错误脱敏、Memory used/none/unavailable，以及少量 Route Handler 认证与成功响应。`server-only` 仅在 Vitest 中映射为空标记；正式 Next.js 代码未变。稳定性任务新增的直接 devDependency 仅 `vitest`。该任务的 `npm test`、`npm run lint`、`npm run typecheck`、`npm run build` 均通过；构建显示正常读取本地 `.env.local`，自动测试本身不需要该文件。

Agent 输入交互任务：只修改 `web/components/agent-workspace.tsx` 的输入与发送交互，增加 `web/components/agent-workspace.test.tsx`；测试直接 devDependencies 增加 `@testing-library/react` 与 `jsdom`。Enter 阻止默认换行后调用现有发送流程；Shift+Enter 保留浏览器换行；IME composing 或 keyCode 229 不发送；空白输入及请求进行中不重复发送。发送按钮保留。AI API、Provider、Router、Memory、数据库与认证逻辑未修改。`npm test` 为 53/53，通过 lint、`npx tsc --noEmit` 和生产构建。

云配额任务：新增 `public.ai_daily_usage` 迁移与无参数原子预占 RPC，Gateway 只在云 Provider 构造成功后、上游调用前预占。表以 `(user_id, usage_date)` 为主键，使用数据库 UTC 日期与条件 UPSERT；每用户每天最多 30 次。数据库真实并发验收脚本位于 `web/scripts/verify-ai-quota-concurrency.mjs`，必须在隔离测试项目执行。SQL 尚未执行，真实 PostgreSQL 原子性、权限与部署后云调用均为**待实测**。不能在代码和数据库迁移均完成前把云配额视为线上生效；配额是请求次数，不是 token/费用预算。

## 遗留问题与下一阶段候选任务

必须由用户决定下一任务范围，以下仅为交接待办，不自动开始：

1. 审查并部署云配额 SQL，在隔离测试 Supabase 项目完成真实并发、权限及 A/B 验收，再决定目标环境部署；不要把 fake RPC 测试视为数据库证明。配额仍不是 token/费用预算，更细的滥用保护待规划。
2. 整次请求 27 秒 Deadline 已在 `fix/ai-gateway-timeout` 实现并用 fake Provider 回归测试；目标 Vercel 实际函数限制、真实阶段耗时和间歇 TIMEOUT 的根因仍待人工验收。
3. 跟踪 Gemini 项目权限；需要时配置并分别验收 OpenAI/DeepSeek，勿伪造成功结果。
4. Memory 联调曾出现间歇 503；后续真实验收已继续通过，但没有持久性根因结论，出现时保留安全错误类别与阶段。
5. README、architecture、development 的旧 OpenRouter 与双账号状态已按现有验收记录校准；在线 Vercel 当前部署是否包含本地 main 未在本次核对。
6. development 中旧 npm audit / ESLint 风险说明未在本次重新联网验证；后续单独检查依赖，不执行未经评估的 force upgrade。
7. Streaming、会话持久化、Embedding、Semantic Search/RAG、Agent Planning、Tools、FastAPI 与 Local Connector 均尚未实现。

## 本分支：AI 智能记忆候选提取

- `web/app/api/ai/memory-candidates/route.ts` 通过当前 Supabase claims 认证与同源/输入校验，只接收本轮用户消息。模型通过现有 Registry/Router 和共用 `web/lib/ai/gateway.ts` 执行真实语义提取；不是关键词规则。候选模型不接收已有 Memory Context 或 AI 回复。
- `web/lib/ai/memory-candidates.ts` 固定服务端指令与严格 JSON schema 边界，限定现有 7 类、每轮 0～3 条、内容与原因长度，并过滤明显敏感内容。模型输出无效时安全失败。当前用户既有 Memory 只在模型调用后通过 authenticated client + RLS 查询，用 NFKC、小写、空白/标点规范化与候选去重。
- Agent UI 默认关闭，开启后在成功聊天回复显示之后调用一次提取接口。只有点击“确认保存”才复用现有 `POST /api/memories`，服务端仍从 Session 得到 user_id，RLS 不变；忽略或清空不会写。确认前再经现有 GET 复查重复，保存失败可重试，重复点击由 ref 防护。保存记录沿用 `source=manual`，无新 migration。
- 提取本身是独立 Gateway 请求：一旦尝试云 Provider，就独立预占一次每日云额度；成功或失败均计，云 fallback 不重复扣。Privacy 只在本地 Ollama 运行，配额不可用时云端 fail-closed。提取失败不影响已经展示的聊天回复。
- 自动测试覆盖候选结构/去重、认证、Privacy、配额、UI 确认/忽略/重试、防重复及既有 Enter/Shift+Enter/IME。真实模型候选质量、实际账号隔离、配额 SQL 部署与 PostgreSQL 并发验收仍待人工验证；不可把 fake 测试说成真实联调。
- 本分支验证：`npm test` 为 9 个测试文件、103/103 通过（原基线 75 项，新增 28 项）；`npm run lint`、`npx tsc --noEmit` 与 `npm run build` 均通过。测试替身未调用任何真实 Provider 或 Supabase。Git 提交与人工联调状态应以实际仓库为准。
- 限制：去重查询上限 1000 条当前用户 Memory；跨标签页并发与语义相似项可能重复。疑似敏感信息过滤是有限规则，不能保证识别全部敏感个人数据；用户必须审核候选。真实模型可能不遵循 JSON 格式，异常时不显示候选。

### 2026-10-09 针对性安全回归

- 候选接口与 Chat API 都拒绝 `routingPreference=privacy` 搭配显式云 Provider；共享 Gateway 也加入同样的防御性检查。显式 Ollama 加 Privacy 仍为本地调用。页面从 Auto Privacy 切到显式 Provider 时提示偏好不生效，候选请求与聊天一样不发送 Auto 偏好。
- 新聊天一开始就使上一轮候选提取失效；迟到的旧响应不能覆盖新候选。关闭建议、清空对话或组件会话切换同样使旧结果失效。已经点击确认的保存可在新一轮聊天开始后继续；账号组件切换前尚未发出的 Memory POST 会停止。
- 明显的密码、Token、Key、邮箱和手机号增加有限规则过滤及测试。该规则不是完整敏感信息识别保证。新增 24 个回归用例后共 9 个测试文件、127 项测试；实际结果以本分支最终验证为准。

### 2026-10-09 AI Gateway 超时治理（`fix/ai-gateway-timeout`）

- 只读审计显示：原先单独的 25 秒显式/12 秒 Auto 尝试、1.5 秒健康检查及 2 秒 Memory 检索可与认证和配额等待叠加，虽声明 `maxDuration=30` 却没有整次预算。此设计有平台截止前来不及安全收尾、第二候选剩余时间不足的风险。没有真实请求逐阶段证据证明间歇 Ollama/OpenRouter TIMEOUT 或 Memory unavailable 的具体根因。
- Chat 与候选接口现在各从入口创建 27 秒共享 Deadline；Auth、校验、Memory、健康探测、云配额、模型与候选去重共用预算。可取消调用接收 AbortSignal；新云端尝试至少要剩 2 秒且必须先取得配额，Auto 仍最多两候选，云 fallback 不重复计数。单个模型超时与总 Deadline 分开；无法取消的认证 SDK/底层传输在截止后可能继续，但迟到结果不会作为响应接受。已提交的配额预占仍按无退款策略计数。
- 每条 AI 请求最多一条 `ai_gateway_request` 安全结构化日志，含随机 requestId、阶段耗时、实际尝试的 Provider、尝试数、Memory 失败粗分类与最终安全错误码，不含用户内容、身份或密钥。Memory 查询仍限 2 秒，底层请求不结束时可按原规则 fail-soft；Auth 失败仍是 401。粗分类无法单独证明数据库/代理根因。
- 本地只读 `/api/show` 元数据确认 `qwen3:8b` 支持 `think:false`，故仅候选提取请求启用；普通聊天与其他模型保持原参数。`openrouter/free` 的实际模型选择与延迟可能变化；本分支没有更换生产模型或环境配置，也没有执行真实模型推理验收。
- Vitest 从原有 127 项增至 13 个文件 145 项，覆盖共享 Deadline、显式/Auto/Privacy 超时、晚到候选、Memory 慢查询 fail-soft、Ollama 提取参数与安全错误映射。测试只用 fake Provider/fetch/Supabase；真实 Vercel 函数限制、上游 429/5xx/超时、Ollama 排队与 Memory 间歇 unavailable 仍待独立人工验证。

### 2026-10-09 Knowledge Base Task 1（`feat/knowledge-base-ingestion`）

- 原 `/knowledge` 固定演示文档与禁用上传已替换为当前账号真实文件列表、浏览器直传、处理状态、删除与空/错误状态。只接受 PDF、UTF-8 TXT、Markdown，单文件最多 4 MiB；正文最多 200,000 字符、PDF 最多 50 页、片段最多 200 个。扫描/加密/无文字 PDF 不支持 OCR。
- 迁移 `supabase/migrations/20261009120000_create_knowledge_base.sql` 定义 `public.knowledge_documents`、`public.knowledge_chunks`、两表 RLS、当前用户所有权及复合外键、五个基于 `auth.uid()` 的受限状态/片段 RPC，以及私有 `knowledge-files` Bucket 的大小、MIME 和路径策略。没有使用 service_role。迁移**未执行**；真实 Storage/RLS 权限和多账号隔离**未验收**。
- Vercel Function 请求体上限当前官方文档为 4.5 MB，所以文件由浏览器凭当前 Supabase Session 直传 Storage，Next.js API 仅接收小型元数据和文档 ID。处理路由重新下载原件，校验真实字节、内容和格式，再解析 PDF 或文本并拆有序片段。原始文件不会传给 AI Gateway，也没有 Embedding/RAG。
- 确定性的格式/解析失败将记录标记 `failed` 并尝试清理文件；临时 Storage/数据库错误保留原件与 `processing`。删除先标记 `deleting`，Storage 删除成功后 RPC 核对对象不存在，再删文档并级联删除片段。中途失败保留可重试状态；停在 `processing` 超过 10 分钟可重新认领。跨 Storage 与数据库没有全局事务，整账号注销删除后的 Storage 孤儿清理仍是运维待办。
- 自动测试使用 fake 数据库/Storage/Session，另用 `pdfjs-dist` 真正解析测试用 PDF 字节；不连接真实 Supabase、云模型或 Ollama。新增 4 个测试文件、32 个用例；全量 17 个文件、177 项测试通过。lint、`npx tsc --noEmit` 与生产构建通过，最终状态以本分支提交报告为准。人工验收先审查并在隔离项目部署迁移，验证 Bucket private、策略、A/B 数据隔离、三种文件、错误与删除恢复，再决定目标环境部署。

## 本地运行和复测

在仓库根目录使用 Windows setup/start 脚本，或在 `web/` 执行：

```sh
npm ci
npm run dev -- --port 3032
```

将 `web/.env.example` 复制为本地 `web/.env.local` 并自行填写配置；禁止覆盖已有真实环境文件或输出内容。主要变量：Supabase URL/publishable key、各云 Provider 的 API_KEY/MODEL、OLLAMA_BASE_URL/MODEL。至少有一个可用模型；Ollama 本地需要服务运行并已安装 `qwen3:8b`。

```sh
npm run lint
npm run build
npm run typecheck
npm run start -- --port 3032
```

全新 checkout 先构建以生成 Next.js 类型文件。当前仓库未迁移；此前用户允许构建使用仓库内 `web/.next`。临时文件/缓存按用户要求放到 D 盘指定工作目录，不修改系统级环境或迁移缓存。

若 Node 不能直连 Supabase，在启动前仅为当前终端设置代理，使用实际端口替换占位符；不要提交个人代理设置：

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:<proxy-port>"
$env:HTTPS_PROXY = "http://127.0.0.1:<proxy-port>"
$env:NO_PROXY = "localhost,127.0.0.1,::1"
$env:NODE_USE_ENV_PROXY = "1"
npm run dev -- --port 3032
```

以上环境代理方式在本对话 Node 24.19.0 环境已验证。浏览器能登录不代表 Node 能连 Supabase；`getClaims()` 网络失败曾导致登录后返回 login，应先排查网络，不重构认证。

登录后在 Agent 选择 Provider 并发送无敏感内容的验收消息。API 为 GET `/api/ai/providers` 和 POST `/api/ai/chat`：

```json
{
  "provider": "auto",
  "routingPreference": "auto",
  "messages": [{ "role": "user", "content": "请只回复：联调成功" }]
}
```

验证显式 OpenRouter、Auto 本地优先、临时不可用后的云切换及恢复、Privacy、匿名 401。模拟只用可恢复的进程级配置，不改正式 Router 或环境文件。另用两个独立 Supabase Session 验证 Memory CRUD 与上下文隔离；不要复制 Cookie/Token 到聊天或日志。

## 新 Codex 对话开始方式

让新对话先读本文件、README、docs/architecture.md、docs/development.md 及相关 AGENTS.md，然后执行 git status、当前 branch 与近期 log，核对本文件的提交状态。由用户确定下一任务分支和下一阶段范围，不自动 Push、PR、Merge 或实现待办。

官方 OpenRouter 接口参考：https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request 。Free Router 参考：https://openrouter.ai/openrouter/free/apps 。
