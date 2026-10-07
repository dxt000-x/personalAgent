# Architecture

## Implemented — Day 2 / Task 1

- Browser → Web：Next.js App Router 提供 Dashboard、Agent、Memory、Knowledge Base 与 Settings UI。
- `/login`、`/signup` 与 `/auth/callback` 提供 Supabase Email / Password 认证基础。
- `@supabase/ssr` 使用 Cookie 会话，`web/proxy.ts` 刷新并通过 `getClaims()` 验证身份；`(workspace)` 服务端布局再次验证后渲染原 UI，URL 不变。
- `POST /api/ai/chat` 与 `GET /api/ai/providers` 是 Next.js 服务端 Route Handler，均通过 Supabase `getClaims()` 验证身份。
- `web/lib/ai/` 提供统一 Provider 接口；OpenAI 使用 Responses API，DeepSeek 使用兼容的 Chat Completions API，Gemini 使用 Google Gen AI SDK，Ollama 使用本地 `/api/chat` HTTP API。云模型密钥与 Ollama 地址/模型只在服务端读取。
- Ollama 默认使用 `http://127.0.0.1:11434` 与 `qwen3:8b`，无云 API Key；Gateway 通过非流式请求取得模型文本，保留统一响应格式。云 Provider 与本地 Provider 可共存，当前必须由请求明确选择 Provider。
- Chat Gateway 对消息数、单条与总输入长度、请求体大小、Provider 超时和输出长度设限，并将上游错误转换为固定错误码。
- 缺少或无效的公开配置时不创建客户端，认证页显示提示，受保护页面跳转登录；无开发绕过入口。
- Agent 通过 React 页面状态演示六步流程及 pending / running / success / error，无真实 Agent 执行。
- `web/` 使用 TypeScript 与 Tailwind CSS，提供 lint、类型检查与生产构建脚本。
- `server/`、`connector/` 仅包含占位说明，不提供服务或 API。
- `.env.example` 提供无密钥配置示例及 Ollama 本地默认值；真实环境配置被 Git 忽略。

当前 Agent 页面仍为 Mock UI，尚未调用 Chat Gateway。只有经过认证且显式调用 API 的请求才会调用已配置的云模型或 Ollama；不保存用户业务数据，也不访问本地文件。默认本地 Ollama 推理不产生云 API Token 费用；当 Next.js 部署在云端时，`127.0.0.1` 仅指云端运行环境自身。

```text
Browser → Next.js Web → Next.js AI Gateway ┬→ OpenAI / DeepSeek / Gemini
                            ↑              └→ Ollama (local model)
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
| Browser / Web | 用户交互与结果展示 | 五个 UI 页面及前端 Mock 交互已实现 |
| API | 请求校验、认证、服务端配置边界 | Next.js AI Gateway 已实现；独立 FastAPI 服务 Planned |
| Personal Agent | 组织任务、协调模型和工具 | Planned |
| Models / Model Router | 调用云模型或本地模型 | OpenAI、DeepSeek、Gemini 与 Ollama 显式选择已实现；Auto Router Planned |
| Memory / RAG | 个人记忆与知识检索 | Planned |
| Tools | 可授权的外部与本地操作 | Planned |
| Supabase | 数据持久化、身份与存储支持 | Auth 基础已实现，业务存储 Planned |
| Local Connector | 连接用户设备上的 Ollama、本地文件与受控命令执行 | Planned，仅目录占位；当前 Ollama 仅能由可访问其服务的 Next.js 服务端调用 |

Supabase 目前仅用于 Web 认证；后端数据与本地能力留待后续任务。FastAPI 仍是未来高级 Agent / Python Tools / RAG 的规划，`server/` 保留占位。认证 Cookie 由官方 SDK 管理，不建立自研 Session 系统。`getSession()` 中未经验证的用户字段不用于服务端授权。

## 配置边界

私密凭据通过服务端环境变量提供，不能硬编码或放入浏览器公开配置。环境示例只保留变量名及空值，不包含数据库密码、Supabase Secret 或机器绝对路径。

本地连接器将需要明确授权与权限控制；当前不实现这些操作。
