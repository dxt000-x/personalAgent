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
- Agent Chat 通过认证后的 `POST /api/ai/chat` 发送消息。最近最多 20 条消息作为多轮上下文，只保存在前端内存，刷新后清空；不建立会话数据库。
- AI Gateway 在模型路由前使用当前 SSR Session 的 Supabase Client 检索 Personal Memory，RLS 是最终所有权边界；当前用户 ID 仅由已验证 claims 获得，客户端不能传入 Memory、用户 ID 或 system prompt。
- Memory 按 importance 降序、created_at 降序检索，最多 8 条；模型上下文不超过 4000 字符，并受 Gateway 16000 字符总输入与消息数预算约束。只格式化 category、importance、content，不发送记录 ID、user_id 或时间戳。
- Memory Context 作为服务端 system/developer instruction 参数传给 Provider；明确将保存内容视为不可信数据，禁止其覆盖系统、安全、认证、隐私或路由规则。Memory 查询失败时不记录原始错误或内容，聊天可继续且 metadata 显示 unavailable；认证失败仍返回 AUTH_REQUIRED。
- Agent Timeline 展示 Received、Validating、Retrieving Memory、Routing、Generating、Completed；响应仅返回 memory status/count，不返回 Memory 内容或数据库标识。
- 缺少或无效的公开配置时不创建客户端，认证页显示提示，受保护页面跳转登录；无开发绕过入口。
- Dashboard 与 Knowledge Base 仍展示演示数据；`/memory` 已使用真实 Supabase 数据，不再显示 Mock Memory。Agent 页面是真实 Chat UI，但不执行 Agent Planning 或工具。
- Personal Context Layer 当前实现：Authenticated User → Personal Memory UI → Next.js Memory API → Supabase SSR Session → `public.memories` → RLS。API 从已验证 claims 获取用户 ID；请求不接受客户端指定 `user_id`；数据库仅授予 authenticated 必需的 SELECT、受限列 INSERT/UPDATE 与 DELETE 权限。
- Memory API 提供 `GET/POST /api/memories` 和 `GET/PATCH/DELETE /api/memories/[id]`，强制 private/no-store 响应。SQL 约束类别、重要度和内容长度；POST 省略 `source`，由数据库 `DEFAULT 'manual'` 填充；更新时间由 trigger 维护。
- 记忆所有权由 SELECT、INSERT、UPDATE、DELETE 四条 authenticated RLS policy 保障。按用户过滤是额外防护，不替代 RLS；跨用户单条访问以 404 安全失败。
- Migration 已由项目维护者在 Supabase 执行并确认 RLS 与四条 Policy。真实登录态使用最小列权限完成 GET 200、POST 201、PATCH 200 与 DELETE 204；响应中的 source 为 `manual`，更新时间 trigger 产生新时间。匿名五种 API 操作均返回 401 `AUTH_REQUIRED`。A/B 双账号及跨账号单条访问尚未验证，因为当前没有第二个测试账号。
- 联调期间多次 PATCH 曾返回 503 `MEMORY_SERVICE_ERROR`，重试后 PATCH 返回 200；未观察到权限拒绝 403。该间歇性服务错误应在后续联调中继续留意。
- `web/` 使用 TypeScript 与 Tailwind CSS，提供 lint、类型检查与生产构建脚本。
- `server/`、`connector/` 仅包含占位说明，不提供服务或 API。
- `.env.example` 提供无密钥配置示例及 Ollama 本地默认值；真实环境配置被 Git 忽略。

Agent Chat 通过认证后的 Gateway 调用 Auto 路由或显式选择的 Provider。OpenRouter 是云 Provider，服务端使用 `OPENROUTER_API_KEY` 与默认模型 `openrouter/free`；配置状态不代表上游已通过真实调用。默认本地 Ollama 推理使用 `qwen3:8b`，由配置的 Ollama 服务处理，不产生云 API Token 费用；对话状态只保存在浏览器页面内存。Gemini Provider 保留，但当前文档不声称 Gemini 上游真实调用已验收成功。部署在 Vercel 时，`127.0.0.1` 指 Vercel 自身，不能访问用户电脑上的 Ollama；配置 OpenRouter 后，Auto 可在本地 Ollama 不可用时尝试该云 Provider。Windows Local Connector 尚未实现。

```text
Browser → Agent Chat (Next.js) → Next.js AI Gateway → Rule-based Model Router ┬→ OpenRouter / OpenAI / DeepSeek / Gemini
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
| Browser / Web | 用户交互与结果展示 | Agent Chat 调用 Gateway；Personal Memory 为真实 CRUD；Dashboard 与 Knowledge UI 中部分示例仍为 Mock |
| API | 请求校验、认证、服务端配置边界 | Next.js AI Gateway 已实现；独立 FastAPI 服务 Planned |
| Personal Agent | 组织任务、协调模型和工具 | Planned |
| Models / Model Router | 调用云模型或本地模型 | OpenRouter、OpenAI、DeepSeek、Gemini、Ollama 显式选择与规则 Auto Router 已实现；OpenRouter 上游真实调用待验收，智能模型评估/质量路由 Planned |
| Memory / RAG | 个人记忆与知识检索 | Manual Memory CRUD/RLS、确定性服务端 Memory Retrieval 与上下文注入已实现；自动提取、Embedding、Semantic Search 与 Vector RAG Planned |
| Tools | 可授权的外部与本地操作 | Planned |
| Supabase | 数据持久化、身份与存储支持 | Auth 与 `public.memories` 的用户隔离手动 CRUD 已实现；其他业务存储 Planned |
| Local Connector | 连接用户设备上的 Ollama、本地文件与受控命令执行 | Planned，仅目录占位；当前 Ollama 仅能由可访问其服务的 Next.js 服务端调用 |

Supabase 用于 Web 认证与 Personal Memory 存储。Memory API 使用现有 SSR Server Client 和经验证的 claims，不建立第二套 Auth 或 service_role 通道。FastAPI 仍是未来高级 Agent / Python Tools / RAG 的规划，`server/` 保留占位。认证 Cookie 由官方 SDK 管理，不建立自研 Session 系统。`getSession()` 中未经验证的用户字段不用于服务端授权。

## Personal Context Layer

**Implemented:** Authenticated User → Session-scoped Memory Retrieval → Safe Context → AI Gateway → Selected Provider。用户可以手动 CRUD 自己的记忆；Gateway 使用同一 authenticated SSR client 查询当前用户记录，额外按 claims 用户 ID 过滤，同时由 RLS 执行最终隔离。检索最多 8 条，优先高 importance、再优先较新记录，Context 有 4000 字符硬上限并受对话剩余输入预算约束。Memory 缺失时不注入上下文且正常聊天；数据库临时失败时 fail-soft 并返回 `memory.status = unavailable`。

**Planned:** AI 自动提取 Memory、Embedding、Semantic Search、Vector Database、Vector RAG、记忆总结与衰减均未实现。当前确定性检索不是 RAG。

## 配置边界

私密凭据通过服务端环境变量提供，不能硬编码或放入浏览器公开配置。环境示例只保留变量名及空值，不包含数据库密码、Supabase Secret 或机器绝对路径。

本地连接器将需要明确授权与权限控制；当前不实现这些操作。

## 调用保护边界

- 所有 AI 调用要求 Supabase 登录，并保留请求体、消息数、单条/总输入、输出长度与超时限制。
- Auto 候选顺序固定为：可用 Ollama，然后按 OpenRouter、OpenAI、DeepSeek、Gemini；最多两次调用。仅 `PROVIDER_ERROR` 与 `TIMEOUT` 允许切换。
- Auto 或显式云 Provider 请求会将当前登录用户的受限 Memory Context 交给最终调用的云服务；Privacy 只允许本地 Ollama。Memory 仍由当前 SSR Session 和 RLS 隔离，响应不返回完整内容，服务端不记录完整 Memory。
- Privacy 偏好只调用已确认可用的 Ollama；没有本地模型时立即拒绝，不发送到云端。云端状态 `unknown` 仅表示没有做健康探测，不代表服务可用。
- 当前没有可靠的持久化 per-user daily quota。启用付费云 Provider 面向公网用户前，必须先实现服务端持久化配额与相应滥用控制；不使用单实例内存计数器替代。
- Vercel 中的 `localhost` / `127.0.0.1` 指云端运行环境，不能连接用户电脑。访问用户设备上的模型或文件需要未来的 Local Connector；本阶段没有实现该连接器。
