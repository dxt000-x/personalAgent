# Personal AI Assistant — 开发交接

更新日期：2026-10-11（Asia/Shanghai）。本文件用于新 Codex 对话接续开发；先核对实际仓库、Git 状态和用户指定任务，再开始修改。

## 项目目标与技术栈

面向大学生和年轻职场人的 Personal AI Workspace。目标是逐步结合个人记忆、知识与受控工具完成任务。当前实现认证、多模型文本对话、确定性路由、手动 Personal Memory 与需用户确认的智能记忆候选；尚未实现自主 Agent。

- Web：Next.js 16.3.8 / App Router、React、TypeScript、Tailwind CSS。
- Auth / Memory：Supabase Auth、`@supabase/ssr`、Supabase Postgres 与 RLS。
- 模型：OpenAI JavaScript SDK、Google Gen AI SDK、Ollama HTTP API。
- 工程：npm 锁文件、ESLint、TypeScript 检查、Next.js production build。
- Windows：根目录 setup/start 的 `.bat` 与 `.ps1` 启动脚本。
- `server/` 与 `connector/` 为占位目录；独立 FastAPI 和 Windows Local Connector 尚未实现。

## 仓库与交接状态

- 当前仓库沿用 `D:\龙虾\Codex\PersonalAgent`，不自动迁移或复制。2026-10-11 本地 `main` 已仅用 fast-forward 同步至 `31ccadfc8e9228f40126366106f87957343ff8e1`；B1 PR #37 合并提交 `d36616765ed34cf586b4141f81794873dec5a8b2`，AI Gateway 4xx 修复 PR #38 合并提交 `31ccadf`。维护者确认 Vercel Production 为 Ready、Current；正式 Knowledge 搜索入口与空结果流程、Agent 页面与模型/路由控件已有基础验收。生产正向搜索命中和真实上游 4xx 故障仍待实测。
- 历史只读安全验收工具分支：`test/knowledge-readonly-security`，基于 `main` 的 PR #33 合并提交 `2f7317008c27c1fb789936a2e14d7d590d30f047`；该分支保存固定生产项目的只读验收工具、离线测试及维护者报告的验收结果。此前文档收尾分支为 `docs/knowledge-base-production-status`。历史知识库接入任务 branch 为 `feat/knowledge-base-ingestion`，当时起点 `8b9cd90`。历史智能记忆候选任务 branch 为 `feat/ai-memory-extraction`，当时基线是 `a1a13ee`。
- 先前 Agent 输入交互任务 branch：`feat/agent-enter-to-send`；该任务已合并到当前基线。
- 先前稳定性任务 branch 为 `test/ai-gateway-regression`；当时 HEAD 与本地 `main`、`origin/main` 均为 `ac1e55a`。
- OpenRouter 合并基线：`2874015`，`Merge pull request #21 from dxt000-x/feat/openrouter-provider`。
- origin：`https://github.com/dxt000-x/personalAgent.git`。
- OpenRouter 功能提交：`7fdf648`（Provider）、`91e176c`（Auto 云候选）、`befa6c5`（文档）。已合并至本地 main。
- 历史稳定性任务只新增自动测试、测试依赖与文档；智能记忆候选提取任务复用现有 Gateway 规则。
- 历史只读验收工具任务开始时，`git ls-remote` 曾返回 `SEC_E_NO_CREDENTIALS`，当时只核对本地引用；本次已成功 `fetch origin` 并确认 `origin/main` 包含 PR #37/#38，再安全同步本地 `main`。两次诊断的时间点不同。

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
- `web/lib/ai/quota.ts`、`supabase/migrations/20261008190000_create_ai_daily_usage.sql`：云 Provider 调用前的 authenticated RPC 预占与 PostgreSQL 持久化每日计数；目标环境的迁移部署及真实并发状态须单独核实。
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
- 云端配额代码已添加；早期交接时 SQL 尚未执行。本次未连接目标数据库复核迁移或并发状态，不能以代码和 fake RPC 测试推断当前生产数据库已完成验收。
- Dashboard 仍含明确的演示数据。Knowledge Base 上传、解析、列表、删除和 B1 基础关键词检索已在生产运行；独立测试项目已完成迁移、文件、隔离、并发和限额真实验收。生产已完成知识库迁移、受限 Writer、三种格式文件，以及 A/B 直接读取片段与原件的只读隔离验收；跨账号处理、删除拒绝及异常恢复仍待验收。B1 独立测试项目的指定文档 A/B 双向隔离、ready/deleting 对照、不带 `documentId` 的四次交叉搜索和正常页面流程已通过；生产搜索入口及空结果流程已有基础验收，正向命中与其他非 ready 状态真实过滤仍待验收。Settings 部分为 UI 设置或占位。

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
- 错误码：AUTH_REQUIRED 401、INVALID_REQUEST 400（请求体超限可为 413）、PROVIDER_NOT_CONFIGURED 503、PRIVACY_PROVIDER_UNAVAILABLE 503、PROVIDER_AUTH_FAILED 502、PROVIDER_REQUEST_REJECTED 502、PROVIDER_ERROR 502、RATE_LIMITED 429、CLOUD_QUOTA_EXCEEDED 429、QUOTA_UNAVAILABLE 503、TIMEOUT 504。
- PR #38 已上线：上游 401/403 映射 `PROVIDER_AUTH_FAILED`，其他不可恢复 4xx 映射 `PROVIDER_REQUEST_REJECTED`，429 映射 `RATE_LIMITED`，均不可 fallback；408 按 `TIMEOUT` 处理并允许 Auto fallback。5xx 和无明确 HTTP 状态的网络故障仍按可恢复 `PROVIDER_ERROR` 处理。错误消息固定脱敏，不返回 SDK stack 或原始错误；真实上游 4xx 场景尚未生产实测。
- 历史交接时未重新执行真实 429、强制超时或 SDK 故障注入；这些旧限制保留为当时状态，不能描述成已实测。

Memory 最多 8 条，按 importance 与创建时间排序；上下文最多 4000 字符，并共享总输入预算。只发送 content/category/importance，不发送数据库标识。查询超时 2 秒，失败时以 unavailable metadata 安全继续聊天。保存内容作为不可信背景，不允许覆盖隐私、认证或路由规则。

## 密钥与数据安全

- 云 Key 只用 `OPENROUTER_API_KEY`、`OPENAI_API_KEY`、`DEEPSEEK_API_KEY`、`GEMINI_API_KEY` 等服务端变量，禁止 `NEXT_PUBLIC_` 前缀。
- Supabase 浏览器配置只使用 URL 与 publishable key；兼容旧 anon key。禁止 service_role 或数据库密码进入浏览器代码。
- `.env` / `.env.*` 被忽略，只有 `.env.example` 可提交。`web/.env.local`、node_modules、`.next` 本次确认未跟踪。
- 本次对已跟踪文件的 OpenRouter Key 特征及非空环境赋值做聚焦扫描，未发现真实 Key；未读取或输出本地 Key。本次未做完整 Git 历史密钥审计。
- API providers 只返回 id/type/configured/availability/model；AI 响应不返回密钥、Cookie、Token、完整 Memory 或内部 Prompt。
- 已审查 AI/Memory 源码没有记录完整 Memory/Prompt 的日志调用。
- 云调用会发送当前会话与受限个人上下文至最终云 Provider；Privacy 才是仅本地模型处理边界。
- 云配额表的仓库迁移设计为：对 `anon`、`authenticated` 无直接权限，启用 RLS 且无开放策略；普通请求不使用 service_role。无参数 `SECURITY DEFINER` RPC 从 `auth.uid()` 获得用户，固定空 search_path、固定上限 30，仅 authenticated 可执行。目标环境实际迁移与权限状态须另行核实。

## 工程验证（历史稳定性任务记录）

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

历史云配额任务：新增 `public.ai_daily_usage` 迁移与无参数原子预占 RPC，Gateway 只在云 Provider 构造成功后、上游调用前预占。表以 `(user_id, usage_date)` 为主键，使用数据库 UTC 日期与条件 UPSERT；每用户每天最多 30 次。数据库真实并发验收脚本位于 `web/scripts/verify-ai-quota-concurrency.mjs`，必须在隔离测试项目执行。当时 SQL 尚未执行；本次未核实目标数据库的当前部署、真实 PostgreSQL 并发和权限状态，不能从代码或自动测试推断已通过。配额是请求次数，不是 token/费用预算。

## 遗留问题与下一阶段候选任务

必须由用户决定下一任务范围，以下仅为交接待办，不自动开始：

1. 审查并部署云配额 SQL，在隔离测试 Supabase 项目完成真实并发、权限及 A/B 验收，再决定目标环境部署；不要把 fake RPC 测试视为数据库证明。配额仍不是 token/费用预算，更细的滥用保护待规划。
2. 整次请求 27 秒 Deadline 已在 `fix/ai-gateway-timeout` 实现并用 fake Provider 回归测试；目标 Vercel 实际函数限制、真实阶段耗时和间歇 TIMEOUT 的根因仍待人工验收。
3. 跟踪 Gemini 项目权限；需要时配置并分别验收 OpenAI/DeepSeek，勿伪造成功结果。
4. Memory 联调曾出现间歇 503；后续真实验收已继续通过，但没有持久性根因结论，出现时保留安全错误类别与阶段。
5. README、architecture、development 的旧 OpenRouter 与双账号状态已按现有验收记录校准；在线 Vercel 当前部署是否包含本地 main 未在本次核对。
6. development 中旧 npm audit / ESLint 风险说明未在本次重新联网验证；后续单独检查依赖，不执行未经评估的 force upgrade。
7. Streaming、会话持久化、Embedding、Semantic Search/RAG、Agent Planning、Tools、FastAPI 与 Local Connector 均尚未实现。

## 历史任务：AI 智能记忆候选提取

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

以下知识库条目按开发发生时间记录；其中“未执行”“待实测”等表述仅反映当时状态，当前结论以文末“生产上线与验收状态”段为准。

- 原 `/knowledge` 固定演示文档与禁用上传已替换为当前账号真实文件列表、浏览器直传、处理状态、删除与空/错误状态。只接受 PDF、UTF-8 TXT、Markdown，单文件最多 4 MiB；正文最多 200,000 字符、PDF 最多 50 页、片段最多 200 个。扫描/加密/无文字 PDF 不支持 OCR。
- 迁移 `supabase/migrations/20261009120000_create_knowledge_base.sql` 定义 `public.knowledge_documents`、`public.knowledge_chunks`、两表 RLS、当前用户所有权及复合外键，以及私有 `knowledge-files` Bucket 的大小、MIME 和路径策略。后续静态安全审查发现：将 `complete_knowledge_document` 授权 authenticated 会允许绕过服务端解析。五个 SECURITY DEFINER 例程现已改置非 Data API 的 `knowledge_private` Schema，撤销 authenticated 权限，改由专用 `knowledge_writer_login` 服务端数据库角色执行；该角色需要维护者在迁移后单独创建并配置 `KNOWLEDGE_DB_URL`，不使用 service_role。迁移**未执行**；真实 Storage/RLS/角色权限和多账号隔离**未验收**。
- Vercel Function 请求体上限当前官方文档为 4.5 MB，所以文件由浏览器凭当前 Supabase Session 直传 Storage，Next.js API 仅接收小型元数据和文档 ID。处理路由重新下载原件，校验真实字节、内容和格式，再解析 PDF 或文本并拆有序片段。原始文件不会传给 AI Gateway，也没有 Embedding/RAG。
- 确定性的格式/解析失败标记 `failed/invalid_file` 并尝试清理文件；临时错误标记 `failed/temporary`，保留原件及页面重试操作。领取前查 Storage 对象，增加 `processing_generation`；超时重新领取后旧结果不能提交。删除先标记 `deleting` 并使代次失效，Storage 删除成功后核对对象不存在，再删文档并级联片段。数据库 trigger 限每用户 100 文档、100 MiB、每 UTC 小时 20 次初始化，领取每小时限 60 次。跨 Storage 与数据库没有全局事务，整账号注销删除后的 Storage 孤儿清理仍是运维待办。
- 自动测试使用 fake 数据库/Storage/Session，另用 `pdfjs-dist` 真正解析测试用 PDF 字节；不连接真实 Supabase、云模型或 Ollama。新增 4 个测试文件、32 个用例；全量 17 个文件、177 项测试通过。lint、`npx tsc --noEmit` 与生产构建通过，最终状态以本分支提交报告为准。人工验收先审查并在隔离项目部署迁移，验证 Bucket private、策略、A/B 数据隔离、三种文件、错误与删除恢复，再决定目标环境部署。

### 2026-10-09 Knowledge Base SQL 安全审查修正（同分支）

- 发现旧迁移中 public `complete_knowledge_document` 授权 authenticated 可让用户绕过 Next.js 解析，直接写任意自己的片段。已改用非 Data API 的 `knowledge_private` SECURITY DEFINER 例程，并撤销普通 JWT 执行权限。独立 NOLOGIN 权限组仅授五个例程；维护者还需单独建立 `knowledge_writer_login`，配置仅服务端使用的 `KNOWLEDGE_DB_URL`。应用拒绝 `postgres` 用户名并使用 TLS；未配置或无完成权限时初始化上传 fail-closed。Supabase `service_role` 未使用。该数据库角色仍可能继承目标库对 PUBLIC 的默认权限，必须在隔离项目做有效权限审计。
- 领取前查 Storage 原件，处理代次防止过期提交；删除使代次失效。临时错误标记 `failed/temporary` 可重试，确定性无效文件仅可删除后重传，清理失败保留元数据及原件。DB 状态失败可在 10 分钟后重领。Trigger 限每用户 100 文档、100 MiB、UTC 小时 20 次初始化，领取每小时 60 次。
- 本地 Vitest 共 20 文件、195/195 通过（相较前次 177 项新增 18 项）；lint、`npx tsc --noEmit`、Next production build 通过。Mock 与 SQL 静态断言不等于 PostgreSQL 安全/并发验收。新增隔离项目直接 RPC/RLS 脚本和只读权限审查 SQL；迁移、专用登录角色、真实 A/B、Storage、边界和并发均**未执行、待实测**。没有改生产 Vercel 配置。

### 2026-10-09 Knowledge Base 第二轮审查补充（同分支）

- 只读审查 SQL 扩展为角色危险属性、递归继承、数据库/Schema/表/序列/函数有效权限、PUBLIC 和默认权限审计；Storage 查询列出 `storage.objects` 的**全部**策略、适用 authenticated 的角色关系与完整 USING/WITH CHECK，不再按策略名筛选。其他 permissive 策略可能按 OR 放宽 `knowledge-files`，实际目标数据库尚未检查。
- Next.js 受限连接限定 Supabase Shared Transaction Pooler `:6543`、自定义角色项目后缀、独立 CA 与 TLS 证书/主机名校验；模块级连接池仍最多 2 个/温实例，连接超时 5 秒、查询超时 10 秒。生产环境变量未查看或修改，Vercel Fluid Compute、真实连接数和证书联调待核实。
- 新增隔离项目数据库并发脚本：两条独立受限 PostgreSQL 连接加隔离项目夹具连接，计划验证领取竞争、过期代次、删除并发、Storage 缺失、100 文档/100 MiB、UTC 小时上传与处理限额。测试脚本会写入隔离项目并尝试清理，**未运行**；须人工批准后执行。用户 ID 仍仅来自服务端 `getClaims().claims.sub`，所有私有例程调用均传该值；上传初始化中的 `user_id` 额外字段被拒绝，处理/删除请求中的同名字段不会覆盖授权身份。自动测试新增身份传递断言。本轮本地 Vitest 为 20 文件、199/199 通过；lint、typecheck、production build 通过。

### 2026-10-09 Knowledge Base 验收脚本可靠性补强（同分支）

- 隔离项目安全脚本改为先通过 Auth 确认 A/B 身份，并验证各自元数据与原始文件确实可下载，再对真实原件验证跨账号下载/删除边界；A 上传拒绝使用 B 的真实待上传 TXT 文档路径。异常放行的临时对象由受限写入角色切换状态、B 本人删除，失败时只输出固定提示。脚本所需变量与清理方式见 `docs/development.md`。
- 隔离项目并发脚本在写入前校验 A/B JWT 身份，异常允许的限额插入也追踪为清理夹具；数据库错误和清理异常不输出原始连接错误或敏感内容。`parse.ts` 的四类明确错误码均已在 `service.ts` 列为不可重试；补充空正文、超限、非法 UTF-8 的服务层状态与清理测试。真实 Supabase 脚本仍**未运行、待人工批准后验收**。
- 本轮本地自动化测试 20 文件、202/202 通过；lint、`npx tsc --noEmit` 与 production build 通过。未执行 Supabase SQL 或隔离项目验收脚本。

### 2026-10-10 Knowledge Base PDF 解析修复（同分支）

- 用户在独立 Supabase 测试项目 `personal-agent-quota-test` 已人工确认 TXT 与 Markdown 上传解析为 ready，PDF 上传失败；迁移、受限角色与 TLS 已通过先前检查。原失败 PDF 在直接 Node.js 中可提取 1 页、259 个字符。另用本机 Word 导出的无敏感两页文字 PDF 复现：直接 Node.js 成功，但修复前 Next.js 生产路由返回 `PDF_PARSE_FAILED`，底层错误是 worker 从 `.next/server/chunks/pdf.worker.mjs` 加载失败。`serverExternalPackages: ["pdfjs-dist"]` 后，本地生产路由能解析 Word 样本及用户原失败文件（后者返回 1 个片段、259 字符）。诊断路由和用户文件均未提交。
- 解析器将无文字层 PDF 明确报告为暂不支持 OCR；已知损坏/加密 PDF 继续拒绝，未知运行时故障按临时错误处理并保留原件。4 MiB、50 页、200,000 字符、200 片段限制不变。真实 Supabase/Vercel 重新上传验收仍待人工执行；旧 `failed/invalid_file` 记录可能已清理原件，需要新建上传。
- `next.config.ts` 也明确将 `pdf.worker.mjs` 纳入知识库处理路由的文件追踪；最终 `.nft.json` 已确认包含 worker。全量 Vitest 23 文件、212/212 项通过，lint、`npx tsc --noEmit`、production build 通过。新增测试夹具仅为自制 Word 导出 PDF，用户桌面原件未复制到仓库。

### 2026-10-10 Knowledge Base 交互式 Storage 安全验收准备（同分支）

- 旧 `verify-knowledge-security.mjs` 无参数模式保留；新增 `--interactive-storage` 仅允许在 `PersonalAgent-KB-Test/web` 运行，固定独立测试项目 Ref `pxfaqcepztzqyqtmbdrf`，人工确认项目名称。脚本不读取原开发目录 `.env.local`，凭据在终端隐藏输入、仅存进程内；A/B 各需一份已主动确认可丢弃的 `kb-isolation-test-` ready 文件。双向 Storage 下载/删除后由所有者复查字节大小及 SHA-256；跨账号上传使用本轮一次性 B uploading 文档，受限写入角色仅执行知识库标记/完成删除例程进行清理。清理失败报告对象 ID 并以非零状态退出。
- 上述记录是当时的脚本开发状态。后续用户已在独立测试项目 `personal-agent-quota-test` 确认 TXT、Markdown、PDF 真实上传，A/B API 与 Storage 双向越权隔离，以及 Storage 一次性夹具清理均通过；并发与额度验收的最终结果见下方当前里程碑。

### 2026-10-10 Knowledge Base 数据库并发验收脚本加固（同分支）

- 数据库并发脚本改为固定项目 Ref `pxfaqcepztzqyqtmbdrf` 和独立测试 Worktree，显式 `--preflight`（只读）、`--execute`（需交互确认完整项目名）、`--inspect-run <Run-ID>`（只读恢复检查）。只允许全新 C/D 测试账号，两人知识库文档、片段、Storage 原件及上传/处理事件必须全部为空；不复用已验收的 A/B。
- `--execute` 在每项写入前将精确文档 ID、路径、归属、阶段写入 Git 忽略的 `.kb-acceptance-runs` 清单；网络结果不确定时停止，保留清单供只读检查。清理只对本轮登记的精确对象执行，并复核用户、数据库角色与归属；不再按用户 ID 自动清空事件。上传/处理事件保留供审计。
- 两条受限连接与仅隔离项目的 `postgres` 夹具连接均限定同一测试项目 Transaction Pooler `:6543`、独立 CA 和严格 TLS。原有双连接争领、过期代次、删除竞态、原件缺失、每小时上传/处理、100 文档及 100 MiB 声明容量断言保留。新增 13 项 fake 测试；全量 Vitest 25 文件、259/259 通过，lint、TypeScript 与 production build 通过。**真实并发验收本轮未执行，生产部署未确认**。运行和中断恢复步骤见 `docs/development.md`。
- 后续独立 Worktree 启动 `--preflight` 时发现 ESM 链接错误：入口导入了辅助模块未再导出的 `PROJECT_NAME`、`PROJECT_REF`。现从既有测试项目常量重新导出，并新增三种入口模式的离线 Node.js ESM 链接测试；测试在开发 Worktree 保护处退出，不读取凭据或连接数据库。真实 `--preflight` 仍待人工重试。
- 用户后续已修正旧 A/B 环境变量名称并用独立只读检查确认 C/D Auth、Writer/Admin TLS 连接成功，但完整 `--preflight` 返回 `UNKNOWN_FAILURE`。脚本原来在运行清单创建前统一显示阶段 `preflight`，多种原始 SQL/网络异常被合并为未知。现将预检拆成逐项只读阶段，失败仅报告当前阶段、最后成功阶段、安全分类和代码；文档/片段、Storage、事件分别查询。新增 13 项 fake 测试，全量 Vitest 26 文件、276/276 通过，lint、typecheck、production build 通过。真实根因仍待人工在独立测试 Worktree 重跑只读预检定位，本轮未连接数据库或执行真实预检。

### 2026-10-10 Knowledge Base 独立测试项目最终验收（历史里程碑）

- 独立测试项目 `personal-agent-quota-test`（Ref `pxfaqcepztzqyqtmbdrf`）已执行并验证知识库迁移和受限角色。TXT、Markdown、PDF 的真实上传与解析通过；A/B 双账号 API、RLS、Storage 隔离及跨账号下载、删除、上传拒绝通过。
- C/D 专用空白账号的 PostgreSQL 只读预检全部 PASS；真实双连接争领、过期 generation、处理与删除竞态、原件缺失拒绝领取通过。每用户 100 文档、100 MiB 声明容量、每 UTC 小时 20 次上传初始化及 60 次处理领取限制通过。100 MiB 测试只验证数据库声明容量，并未实际上传 100 MiB 文件。
- Run ID `ad0ef8cd-f98e-4a79-9f85-3b53816f9788` 的登记文档及 Storage 对象已清理并经 `--inspect-run` 只读复核；上传与处理事件行保留供审计。此前 `UNKNOWN_FAILURE` 和“并发未运行”是历史状态，不代表当前验收失败。
- 当时生产 Supabase 知识库迁移、受限连接及 Vercel 联调、PR Merge 尚未完成；这是合并前的历史状态，不代表当前部署状态。当时知识库只实现文件接入与片段保存；后续 B1 已增加关键词搜索，但 Embedding、向量检索或 RAG 仍未实现。

### 2026-10-10 Knowledge Base 基础关键词检索（历史开发与隔离验收记录）

- `feat/knowledge-search-mvp` 基于已核实的 `main` 提供只读基础关键词检索与 Knowledge 页面来源摘录；正式 `POST /api/knowledge/search` 支持可选 `documentId` UUID 精确过滤，不提供时检索当前用户全部 ready 文档。接口使用当前 SSR authenticated Client、现有 RLS 和 ready 文档过滤；输入最多 100 字、请求体最多 512 字节，最多 5 条结果、每条摘录 600 字、摘录合计不超过 4000 字，查询限时 3 秒。不需要新 Migration，不调用 AI 或 Storage。
- 独立测试项目 `personal-agent-quota-test` 使用普通 A/B 身份，对已授权的指定文档完成双向搜索隔离 PASS；ready 精确搜索命中 PASS；唯一合成 TXT 文档在片段仍存在的 deleting 状态下，同一 A 会话以相同关键词和 `documentId` 搜索得到 HTTP 200、空结果 PASS；该 Run ID 登记的文档、片段及 Storage 对象精确清理 PASS。这些实测只覆盖指定文档及会话，不代表生产验收。
- 另一轮独立项目验收 Run ID `ffe041f7-5d45-4779-a471-ea4de3c5bd60`：普通 A/B 各建立一份唯一关键词的合成 ready TXT；不带 `documentId` 的正式搜索四次均为 HTTP 200，A 搜 A、B 搜 B 各显示本人合成文件的 1 条结果，A 搜 B、B 搜 A 各返回 0 条；Knowledge 正常页面搜索流程 PASS。页面唯一文件名与登记文档对应，但未直接捕获响应 JSON 中的 `documentId` 字段，不得宣称该字段已直接核验。两份夹具各由本人正常删除，按精确文档 ID 与 Storage 路径只读复核文档、片段、对象均为 0；上传/处理审计事件可按设计保留。
- uploading、processing、failed 其他非 ready 状态的真实过滤均 NOT RUN；当时生产 B1 尚未部署，现已由 PR #37 合并上线，但生产正向命中仍待验证。此前 Preview 部署检查 Success，但当次环境归属及登录后功能验收未确认。独立测试 Worktree 的 B1 定向测试 38/38 通过，Lint、TypeScript 和 Production Build 通过；全量 Vitest 实际为 306/309，3 项数据库验收入口环境守卫测试在授权测试 Worktree 中得到 WRONG_PROJECT_KIND，而旧断言预期 WRONG_WORKTREE，不得写为全量通过。
- 同一测试文档在验收过程观察到两次 DELETE，分别返回 204 与 503；第二次 503 的具体失败分支仍 UNKNOWN，最终对象清理复核为零不代表此异常已定位。历史 localhost/127.0.0.1 Origin 故障根因仅为 LIKELY。上述独立项目验收不能代替生产正向搜索或其他非 ready 状态的实测。

### 2026-10-10 Knowledge Base 文件接入生产上线与验收状态（历史里程碑）

- PR #32 已合并至 `main`，Merge Commit 为 `15c3ab5`；GitHub Actions Ubuntu CI 已通过，Vercel Production Deployment 状态 Ready。合并前 Windows 本地自动化测试为 279/279 通过；本轮文档分支验证结果应以实际运行记录为准。
- 生产 Supabase `personal-ai-assistant` 已执行知识库 Migration，维护者核验私有 Schema、表、RLS、私有 Storage Bucket、函数与限额触发器。生产专用 `knowledge_writer_login` 已创建，Session Pooler 5432、Transaction Pooler 6543 连接测试及 Writer 最小权限检查 6/6 通过；Vercel Production 已配置受限连接与 TLS CA 所需服务端变量。备份、归档读取、权限快照和副本已准备，但未进行完整数据库恢复演练。
- 生产 TXT、Markdown、PDF 上传与解析均达到 `ready` 并生成片段；删除和数据库/Storage 清理已通过。A/B 双向页面列表隔离通过，B 的 `GET /api/knowledge` 返回 200 和空 `documents`。维护者只读 SQL 确认本轮测试文档、知识库全部文档、全部片段、Storage 对象及孤立对象均为 0；上传和处理审计事件可按设计保留，不应当作残留文件删除。
- **生产只读跨账号实测（维护者报告）：**使用 `web/scripts/verify-knowledge-readonly-production.mjs` 对同一份 A 所有的登记文件验收：A 直接读取 `knowledge_chunks` 返回 1 条，B 用自身会话查询同一 `document_id` 返回 0 条；A 下载 Storage 原件为 475 字节，B 对同一路径收到 HTTP 400，SDK 错误代码为 `NoSuchKey`，未取得原件；B 身份二次核验后，A 再次下载的大小及 SHA-256 与首次一致，工具最终输出 `READONLY_ACCEPTANCE PASS`。这份结果限于该生产测试文件与当次 A/B 会话，不等于所有策略组合均经实测。
- 维护者随后通过正常页面删除该测试文件，并用生产只读 SQL 确认：测试文档、测试片段、测试 Storage 对象，以及知识库全部文档、全部片段、全部 Storage 对象和孤立 Storage 对象的残留数均为 0。上传/处理审计事件可按设计保留。本轮未重新连接生产项目或执行 SQL。
- **生产仍待验收：**跨账号处理、删除拒绝；Storage 删除失败与损坏文件残留恢复；完整数据库恢复演练。独立项目 A/B 和 C/D 验收不能替代这些生产测试。知识库现已支持 PDF/TXT/MD 文件接入、解析、持久化及 B1 关键词搜索，尚未实现 Embedding、向量检索或 RAG。

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
