# Personal AI Assistant

面向大学生和年轻职场人的 Web Personal AI Agent，目标是帮助用户组织学习、工作与个人知识。

## 在线体验

🌐 **Live Demo：**  
https://personal-agent-seven-mu.vercel.app

### 当前版本

**V0.1 — Web Foundation + Agent UI + Supabase Authentication**

当前已实现：

- ✅ Next.js Web 应用基础架构
- ✅ Personal AI Agent Workspace
- ✅ Dashboard
- ✅ Agent Execution Timeline UI
- ✅ Personal Memory UI
- ✅ Knowledge Base UI
- ✅ Settings
- ✅ Supabase 用户注册 / 登录 / 退出
- ✅ 服务端身份认证与受保护路由
- ✅ Vercel 公网部署

> 当前 Agent、个人记忆、知识库的 AI 核心能力仍在持续开发中。

## 比赛项目目标

通过统一的 Web 入口，逐步探索个人 AI 助手如何结合模型、个人记忆、知识检索和工具，提供可理解、可控的个性化支持。

## 当前开发阶段

**Day 1 / Task 3：用户认证基础架构。** 已加入 Supabase Auth 邮箱注册、登录、退出及路由保护。Task 2 的任务、记忆、文档和进度仍为演示数据。没有实现用户业务数据、AI、后端 API 或本地连接器。

## 技术架构概览

```text
Browser → Next.js Web → FastAPI API → Personal Agent
                                      ├─ Models / Model Router
                                      ├─ Memory / RAG / Tools
                                      └─ Windows Local Connector
```

未来计划使用 Supabase 保存相关数据，接入 OpenAI / DeepSeek / Gemini；本地连接器计划连接 Ollama、本地文件与受控命令执行。以上均为规划。

```text
web/          Next.js + TypeScript + Tailwind CSS + App Router
server/       FastAPI 后端占位说明
connector/    Windows Local Connector 占位说明
docs/         架构与开发流程
.env.example  空值环境变量示例
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

## 当前已实现功能

- `/login`、`/signup`：邮箱密码认证、确认密码校验、Loading/Error 状态及邮箱确认回调。
- Supabase 官方 `@supabase/ssr` 浏览器/服务端客户端，Cookie 会话、Proxy 刷新与服务端身份校验。
- Dashboard / Agent / Memory / Knowledge / Settings 未登录时跳转 `/login`；侧栏展示认证邮箱及退出入口。
- 统一侧边导航与 Dashboard：今日重点、项目、最近任务、演示记忆与继续任务入口。
- `/agent`：任务输入、聊天 UI 与六步执行时间线；支持手动推进、模拟错误、重试和重置。
- `/agent?new=1`：空白演示任务入口，提交后启动固定前端流程。
- `/memory`：五类演示个人记忆；编辑/删除暂不可用。
- `/knowledge`：演示文件列表；上传与检索暂不可用。
- `/settings`：模型、自主程度的本地 UI 选择，以及服务商/连接器占位。
- TypeScript 严格类型配置、Tailwind CSS 样式。
- ESLint、类型检查与构建脚本，npm 锁文件。
- 后端与本地连接器占位目录。
- 环境变量示例、敏感文件忽略规则与架构/开发文档。

工作空间的演示状态仅存在于页面内存，刷新后重置；示例结果为固定内容，不随输入生成。仅认证会话由 Supabase 管理，没有业务数据持久化、文件读取、命令执行或 AI 请求。

## Planned Features

- FastAPI 后端与 Personal Agent。
- 个性化 Memory、个人知识 RAG 与 Tools。
- Supabase 用户业务数据存储（认证基础已实现，需配置项目验证）。
- OpenAI / DeepSeek / Gemini 模型接入与 Model Router。
- Windows Local Connector、Ollama、本地文件与受控命令执行。

## 配置与安全

所有 API Key 和数据库凭据必须由环境变量提供。根目录 `.env.example` 仅包含空值；本阶段只读取两个公开 Supabase 认证配置。

Next.js 只读取 Web 应用目录中的环境文件。将以下配置填入 `web/.env.local`：

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

使用 Supabase 项目的 Project URL 和 publishable key。配置优先读取 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`；未填写或仅含空白时兼容旧的 `NEXT_PUBLIC_SUPABASE_ANON_KEY`。两者同时存在时使用 publishable key。严禁把 service_role、secret key 或数据库密码填入这些公开变量。修改后重启开发服务；生产环境修改后需重新构建。根目录示例不会自动被 Web 加载。

在 Supabase Auth 开启 Email provider。设置 Site URL 为本地开发地址，并在 Redirect URLs 中允许 `http://localhost:3000/auth/callback`（部署时使用实际站点地址）。开启邮箱确认时，注册后按提示在同一浏览器打开邮件链接，回调交换 PKCE code 后进入 Dashboard；若没有即时 session，页面不会假装已经登录。关闭邮箱确认时，注册得到 session 后直接进入 Dashboard。此应用不自动更改 Supabase 的认证策略。

登录成功后进入 `/`；退出只注销当前浏览器会话并返回 `/login`。认证校验失败或服务不可用时不会放行受保护页面。没有配置的本地环境无法登录，也无法直接查看工作空间。

参考 [Supabase 官方 Next.js SSR 文档](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs)。未来后端私密配置放在 `server/.env` 并由后端加载，私密值不得使用 `NEXT_PUBLIC_` 前缀。

`.env` 及 `.env.*` 默认被 Git 忽略，仅 `.env.example` 可提交。不得提交真实密钥、个人机器路径或生成文件。

开发协作流程见 [开发文档](docs/development.md)。
