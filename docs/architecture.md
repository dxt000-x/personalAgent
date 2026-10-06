# Architecture

## Implemented — Day 1 / Task 3

- Browser → Web：Next.js App Router 提供 Dashboard、Agent、Memory、Knowledge Base 与 Settings UI。
- `/login`、`/signup` 与 `/auth/callback` 提供 Supabase Email / Password 认证基础。
- `@supabase/ssr` 使用 Cookie 会话，`web/proxy.ts` 刷新并通过 `getClaims()` 验证身份；`(workspace)` 服务端布局再次验证后渲染原 UI，URL 不变。
- 缺少或无效的公开配置时不创建客户端，认证页显示提示，受保护页面跳转登录；无开发绕过入口。
- Agent 通过 React 页面状态演示六步流程及 pending / running / success / error，无真实 Agent 执行。
- `web/` 使用 TypeScript 与 Tailwind CSS，提供 lint、类型检查与生产构建脚本。
- `server/`、`connector/` 仅包含占位说明，不提供服务或 API。
- `.env.example` 提供空值示例；真实环境配置被 Git 忽略。

当前 Web 仅与 Supabase Auth 交互，不发送 AI 请求，不保存用户业务数据，也不访问本地文件。

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
| API | 请求校验、认证、服务端配置边界 | Planned，仅目录占位 |
| Personal Agent | 组织任务、协调模型和工具 | Planned |
| Models / Model Router | 路由 OpenAI、DeepSeek、Gemini 等模型 | Planned |
| Memory / RAG | 个人记忆与知识检索 | Planned |
| Tools | 可授权的外部与本地操作 | Planned |
| Supabase | 数据持久化、身份与存储支持 | Auth 基础已实现，业务存储 Planned |
| Local Connector | 连接 Ollama、本地文件与受控命令执行 | Planned，仅目录占位 |

Supabase 目前仅用于 Web 认证；后端数据、云模型与本地能力留待后续任务。认证 Cookie 由官方 SDK 管理，不建立自研 Session 系统。`getSession()` 中未经验证的用户字段不用于服务端授权。

## 配置边界

私密凭据通过服务端环境变量提供，不能硬编码或放入浏览器公开配置。环境示例只保留变量名及空值，不包含数据库密码、Supabase Secret 或机器绝对路径。

本地连接器将需要明确授权与权限控制；Day 1 不实现这些操作。
