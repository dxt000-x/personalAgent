# Personal AI Assistant

面向大学生和年轻职场人的 Web Personal AI Agent，目标是帮助用户组织学习、工作与个人知识。

## 比赛项目目标

通过统一的 Web 入口，逐步探索个人 AI 助手如何结合模型、个人记忆、知识检索和工具，提供可理解、可控的个性化支持。

## 当前开发阶段

**Day 1 / Task 1：项目基础架构。** 当前仅实现可运行的 Web 基础页面、目录组织与开发文档。AI、数据库、后端 API 和本地连接器尚未实现。

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

打开 http://localhost:3000。当前页面无需 API Key、数据库或后端，也不需要复制环境文件。

检查及生产运行：

```sh
npm run lint
npm run typecheck
npm run build
npm run start
```

首次安装后，Next.js 在运行或构建时自动生成 `next-env.d.ts`。首次单独执行类型检查前，可先执行 `npm run build`。

## 当前已实现功能

- App Router 首页，展示项目介绍、当前阶段与规划功能。
- TypeScript 严格类型配置、Tailwind CSS 样式。
- ESLint、类型检查与构建脚本，npm 锁文件。
- 后端与本地连接器占位目录。
- 环境变量示例、敏感文件忽略规则与架构/开发文档。

## Planned Features

- FastAPI 后端与 Personal Agent。
- 个性化 Memory、个人知识 RAG 与 Tools。
- Supabase 数据存储与用户认证。
- OpenAI / DeepSeek / Gemini 模型接入与 Model Router。
- Windows Local Connector、Ollama、本地文件与受控命令执行。

## 配置与安全

所有 API Key 和数据库凭据必须由环境变量提供。根目录 `.env.example` 仅包含空值，列出的变量保留给未来集成，当前没有代码读取它们。

Next.js 只读取 Web 应用目录中的环境文件；未来 Web 配置应放在 `web/.env.local`，后端私密配置放在 `server/.env` 并由后端加载。根目录示例不会自动被 Web 加载。私密 API Key、数据库密码和 Supabase Secret 不得使用 `NEXT_PUBLIC_` 前缀或传到浏览器。

`.env` 及 `.env.*` 默认被 Git 忽略，仅 `.env.example` 可提交。不得提交真实密钥、个人机器路径或生成文件。

开发协作流程见 [开发文档](docs/development.md)。
