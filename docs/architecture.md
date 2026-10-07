# Architecture

## Implemented — Day 2 / Task 3

- Browser → Web：Next.js App Router 提供 Dashboard、Agent、Memory、Knowledge Base 与 Settings UI。
- `/login`、`/signup` 与 `/auth/callback` 提供 Supabase Email / Password 认证基础。
- `@supabase/ssr` 使用 Cookie 会话，`web/proxy.ts` 刷新并通过 `getClaims()` 验证身份；`(workspace)` 服务端布局再次验证后渲染原 UI，URL 不变。
- `POST /api/ai/chat` 与 `GET /api/ai/providers` 是 Next.js 服务端 Route Handler，均通过 Supabase `getClaims()` 验证身份。
- `web/lib/ai/` 提供统一 Provider 接口；OpenAI 使用 Responses API，DeepSeek 使用兼容的 Chat Completions API，Gemini 使用 Google Gen AI SDK，Ollama 使用本地 `/api/chat` HTTP API。云模型密钥与 Ollama 地址/模型只在服务端读取。
- Ollama 默认使用 `http://127.0.0.1:11434` 与 `qwen3:8b`，无云 API Key；Gateway 通过非流式请求取得模型文本，保留统一响应格式。云 Provider 与本地 Provider 可共存。
- Chat Gateway 对消息数、单条与总输入长度、请求体大小、Provider 超时和输出长度设限，并将上游错误转换为固定错误码。
- `/agent` 默认使用确定性 Auto 路由，可选显式 Provider 与 Privacy 本地优先模式。Ollama 使用短超时 `/api/tags` 检查可用性；云 Provider 只显示已配置与健康未知，不发起健康探测模型调用。
- Auto 本地可用时优先 Ollama；本地不可用时按固定顺序考虑已配置的云 Provider。最多调用两个候选，且仅在上游错误或超时后 fallback；鉴权、请求校验、限流错误不会触发 fallback。显式 Provider 永不切换。Privacy 模式只尝试本地 Ollama，模型不可用时返回明确错误，不向云端发送消息。
- Agent Chat 通过认证后的 `POST /api/ai/chat` 发送消息。最近最多 20 条消息作为多轮上下文，只保存在前端内存，刷新后清空；不建立会话数据库。
- Agent Timeline 展示 Received、Validating、Routing、Generating、Completed 请求阶段，并在成功后显示实际 Provider、模型与安全路由原因；未实现 Agent Planning、Memory Retrieval、RAG 或 Tool Calling。
- 缺少或无效的公开配置时不创建客户端，认证页显示提示，受保护页面跳转登录；无开发绕过入口。
- Dashboard、Memory 与 Knowledge Base 仍展示演示数据；Agent 页面是真实 Chat UI，但不执行 Agent Planning 或工具。
- `web/` 使用 TypeScript 与 Tailwind CSS，提供 lint、类型检查与生产构建脚本。
- `server/`、`connector/` 仅包含占位说明，不提供服务或 API。
- `.env.example` 提供无密钥配置示例及 Ollama 本地默认值；真实环境配置被 Git 忽略。

Agent Chat 通过认证后的 Gateway 调用 Auto 路由或显式选择的 Provider。默认本地 Ollama 推理使用 `qwen3:8b`，由配置的 Ollama 服务处理，不产生云 API Token 费用；对话状态只保存在浏览器页面内存。Gemini Provider 保留，但当前文档不声称 Gemini 上游真实调用已验收成功。部署在 Vercel 时，`127.0.0.1` 指 Vercel 自身，不能访问用户电脑上的 Ollama；Windows Local Connector 尚未实现。

```text
Browser → Agent Chat (Next.js) → Next.js AI Gateway → Rule-based Model Router ┬→ OpenAI / DeepSeek / Gemini
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
| Browser / Web | 用户交互与结果展示 | Agent Chat 调用 Gateway；Dashboard、Memory、Knowledge UI 中的示例内容仍为 Mock |
| API | 请求校验、认证、服务端配置边界 | Next.js AI Gateway 已实现；独立 FastAPI 服务 Planned |
| Personal Agent | 组织任务、协调模型和工具 | Planned |
| Models / Model Router | 调用云模型或本地模型 | OpenAI、DeepSeek、Gemini、Ollama 显式选择与规则 Auto Router 已实现；智能模型评估/质量路由 Planned |
| Memory / RAG | 个人记忆与知识检索 | Planned |
| Tools | 可授权的外部与本地操作 | Planned |
| Supabase | 数据持久化、身份与存储支持 | Auth 基础已实现，业务存储 Planned |
| Local Connector | 连接用户设备上的 Ollama、本地文件与受控命令执行 | Planned，仅目录占位；当前 Ollama 仅能由可访问其服务的 Next.js 服务端调用 |

Supabase 目前仅用于 Web 认证；后端数据与本地能力留待后续任务。FastAPI 仍是未来高级 Agent / Python Tools / RAG 的规划，`server/` 保留占位。认证 Cookie 由官方 SDK 管理，不建立自研 Session 系统。`getSession()` 中未经验证的用户字段不用于服务端授权。

## 配置边界

私密凭据通过服务端环境变量提供，不能硬编码或放入浏览器公开配置。环境示例只保留变量名及空值，不包含数据库密码、Supabase Secret 或机器绝对路径。

本地连接器将需要明确授权与权限控制；当前不实现这些操作。

## 调用保护边界

- 所有 AI 调用要求 Supabase 登录，并保留请求体、消息数、单条/总输入、输出长度与超时限制。
- Auto 候选顺序固定为：可用 Ollama，然后按 OpenAI、DeepSeek、Gemini；最多两次调用。仅 `PROVIDER_ERROR` 与 `TIMEOUT` 允许切换。
- Privacy 偏好只调用已确认可用的 Ollama；没有本地模型时立即拒绝，不发送到云端。云端状态 `unknown` 仅表示没有做健康探测，不代表服务可用。
- 当前没有可靠的持久化 per-user daily quota。启用付费云 Provider 面向公网用户前，必须先实现服务端持久化配额与相应滥用控制；不使用单实例内存计数器替代。
- Vercel 中的 `localhost` / `127.0.0.1` 指云端运行环境，不能连接用户电脑。访问用户设备上的模型或文件需要未来的 Local Connector；本阶段没有实现该连接器。
