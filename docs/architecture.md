# Architecture

## Implemented — Day 1 / Task 1

- Browser → Web：Next.js App Router 提供静态内容首页。
- `web/` 使用 TypeScript 与 Tailwind CSS，提供 lint、类型检查与生产构建脚本。
- `server/`、`connector/` 仅包含占位说明，不提供服务或 API。
- `.env.example` 提供空值示例；真实环境配置被 Git 忽略。

当前 Web 不发送 AI 请求，不保存用户数据，也不访问本地文件。

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
| Browser / Web | 用户交互与结果展示 | 仅基础首页已实现 |
| API | 请求校验、认证、服务端配置边界 | Planned，仅目录占位 |
| Personal Agent | 组织任务、协调模型和工具 | Planned |
| Models / Model Router | 路由 OpenAI、DeepSeek、Gemini 等模型 | Planned |
| Memory / RAG | 个人记忆与知识检索 | Planned |
| Tools | 可授权的外部与本地操作 | Planned |
| Supabase | 数据持久化、身份与存储支持 | Planned |
| Local Connector | 连接 Ollama、本地文件与受控命令执行 | Planned，仅目录占位 |

Supabase 将为后端数据能力提供支持；云模型由服务端调用；本地能力通过 Windows Connector 接入。具体 API、数据模型、认证与权限协议留待后续任务设计。

## 配置边界

私密凭据通过服务端环境变量提供，不能硬编码或放入浏览器公开配置。环境示例只保留变量名及空值，不包含数据库密码、Supabase Secret 或机器绝对路径。

本地连接器将需要明确授权与权限控制；Day 1 不实现这些操作。
