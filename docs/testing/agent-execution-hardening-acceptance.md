# Agent Execution Authorization Hardening 隔离验收

## 当前状态

本文件同时记录既有验收证据和后续操作步骤，测试目标仅为 `personal-agent-quota-test`（Ref `pxfaqcepztzqyqtmbdrf`）。先前的隔离数据库验收记录为 `ISSUE=PASS`、`TLS=PASS`、`ROLE=PASS`、`CONCURRENCY=PASS`、`FINISH=PASS`；相关函数已可调用，但本轮未重新运行数据库测试，也未独立复核 Migration 执行记录及完整对象权限。针对下文精确 JTI 的 HTTP 并发审计核验为 `AUDIT_READ=PASS`；其他 HTTP 场景不能据此一并判定通过。不得连接 Production 项目 `uuktbpywrzflrdbxnzfx`。

## 1. 项目与 Migration 门禁

1. 在 Supabase Dashboard 项目选择器同时核对名称 `personal-agent-quota-test` 和 URL 中的 Ref `pxfaqcepztzqyqtmbdrf`。确认 SQL Editor 顶部仍显示这个项目；若有差异立即停止。
2. 在仓库检查 `supabase/migrations/20261017120000_create_agent_execution_audit.sql` 的完整内容，并记录 `Get-FileHash -Algorithm SHA256`。检查 `agent_private` schema、`agent_execution_writer` 角色和同名表/函数是否已存在，避免重复执行。
3. 仅在目标项目尚未应用 Migration、且取得单独的远程数据库变更授权后，才可手动应用这**一份** Migration；不得对已存在的对象重复执行。不得以 Production 或不明归属的 Preview 代替。应用后只读核对对象、RLS、函数定义和授权；既有函数调用成功不代替这些独立核验。

## 2. 受限 Writer

由维护者通过批准的秘密管理方式为测试项目创建专用 `agent_execution_writer_login` 登录角色，设置高熵密码，使其仅继承 Migration 中的 `agent_execution_writer`。该角色应仅有 `agent_private` schema 的 USAGE 与三个函数的 EXECUTE，不得获得两张审计表的直接 SELECT/INSERT/UPDATE/DELETE，不得继承 `postgres`、`service_role` 或其他广泛权限。不要把密码放入 SQL 文件、聊天或 Git。

`AGENT_DB_URL` 使用测试项目 Shared Transaction Pooler：`postgresql://agent_execution_writer_login.pxfaqcepztzqyqtmbdrf:<URL 编码的密码>@<该项目的 pooler 主机>:6543/postgres?sslmode=require`。从测试项目 Dashboard 核对 pooler 主机；不能仅凭字符串外形推断归属。应用还要求 `NEXT_PUBLIC_SUPABASE_URL` 的 Ref 与上述 Ref 一致。

`AGENT_DB_CA_CERT_BASE64` 是测试项目官方连接说明所要求的可信 CA PEM 的 Base64 编码。由维护者核验证书来源；不得关闭证书校验。测试脚本用 X.509 解析 CA，并以 pooler 主机为 SNI、`rejectUnauthorized: true` 建立连接，连接后检查 TLS 授权状态。不要显示完整 URL、密码、证书或 Base64。

## 3. 双连接并发验收

既有脚本结果：`ISSUE=PASS`、`TLS=PASS`、`ROLE=PASS`、`CONCURRENCY=PASS`、`FINISH=PASS`。这是先前的隔离测试记录，本轮未重新运行；脚本输出的 `AUDIT_READ=NOT_RUN` 仍须保留，不能据此声称已经只读核对审计表。

仅在 Migration、Writer 权限和项目身份核对通过后，在隔离测试运行环境设置进程环境变量 `NEXT_PUBLIC_SUPABASE_URL`、`AGENT_DB_URL`、`AGENT_DB_CA_CERT_BASE64`，并显式设置 `AGENT_DB_ACCEPTANCE_RUN=pxfaqcepztzqyqtmbdrf` 与 `AGENT_DB_ACCEPTANCE_PROJECT_NAME=personal-agent-quota-test`。使用批准的本机秘密注入方法；不要修改主仓库 `.env.local`。脚本**不加载**任何环境文件。

在 `web` 目录运行 `node scripts/verify-agent-execution-db-concurrency.mjs`。脚本使用项目现有 `pg` 驱动、两个独立连接和合成 UUID；调用受限签发函数创建一条授权，再并发调用消费函数。预期恰好一次 `acquired`、一次 `replay`，然后通过受限完成函数标记成功。它只输出 Run ID、JTI 与脱敏阶段结果。失败后停止；若 ISSUE 已成功，保留 JTI 供只读审计，不自动删除。执行前应确保没有网络代理或其他路径将连接导向非测试项目。

Writer 没有直接审计表读权限。在**已确认的测试项目** SQL Editor 中仅按脚本输出的精确 JTI 只读核对，勿扩大查询：

```sql
select jti, user_id, tool, state, issued_at, started_at, finished_at,
       replay_rejected_count, last_replay_at
from agent_private.execution_authorizations
where jti = '<本轮 JTI>'::uuid;

select event, error_code, occurred_at
from agent_private.execution_events
where jti = '<本轮 JTI>'::uuid
order by event_id;
```

预期状态为 `succeeded`，重放计数为 1，事件包含 `issued`、`started`、`replay_rejected`、`succeeded`。SQL Editor 只读核验结果须单独登记；脚本成功不能代替此核验。

## 4. 登录后 HTTP 验收

先核对本地应用确实使用测试项目、已应用 Migration、受限 Writer 和严格 TLS，并确认 OpenRouter 的测试模型及额度可用。用普通测试账号登录 `http://localhost:3110/agent`，或打开已核对提交的目标 Preview `/agent`。在该页面 DevTools Console 粘贴 `web/scripts/agent-execution-http-acceptance.js` 的完整内容。脚本仅向同源的 `/api/agent/plan`、`/api/agent/confirm`、`/api/agent/execute` 发送请求；Provider 固定为 `openrouter`。它不输出 Plan 正文或授权原文；脚本会先提示真实模型请求及额度影响，由操作者决定是否继续。

预期首次 Execute 为 200 且返回有效 `read_current_time` ISO 时间；同一授权重放为 409 `REPLAY_REJECTED`；另一个授权的两个并发 Execute 恰好一个 200、一个 409。伪造授权、篡改 Plan 与等待过期的授权应被拒绝。跨用户测试需要独立 B 会话并在有效期内切换，**该脚本标记 NOT RUN**；如另行测试，必须单独记录实际状态码及错误码。脚本中的 `CHECK` 行是本地汇总断言，不是 HTTP 状态码。网络或前置请求失败时，不得将后续步骤记为 PASS。

并发请求复用同一份 Confirm 签发的执行授权。脚本仅在浏览器内从该授权的签名载荷提取符合 UUID 格式的 JTI，供审计关联；这不是客户端验签，也不代替服务端授权校验。保存脱敏的 `concurrent_audit` 汇总行（JTI、两个 HTTP 状态码、受限错误码、`verdict`），不要保存授权 token、Cookie、Plan 或请求正文。维护者先确认测试项目 Ref，再将**此行的精确 JTI**填入第 3 节的两条只读 SQL；核对授权最终状态和事件计数。数据库并发脚本输出的是另一条合成授权 JTI，不得与 HTTP JTI 混用。

### 本次 HTTP 并发与审计核验：PASS

证据来源为本次 HTTP 并发测试的脱敏摘要，以及 Supabase 对精确 JTI `71108f00-6048-43b3-9677-9b50dffeb0e6` 的只读查询结果；两者已按此 JTI 关联。以下结果由维护者提供并确认，本次文档更新没有重新发送 HTTP 请求或执行 SQL：

| 核验项 | 实际结果 |
| --- | --- |
| 两个并发 Execute | HTTP 200 一次；HTTP 409、`REPLAY_REJECTED` 一次 |
| 授权最终状态 | `succeeded` |
| `replay_rejected_count` | 1 |
| 审计事件 `issued` / `started` / `succeeded` / `failed` / `replay_rejected` | 1 / 1 / 1 / 0 / 1 |

该精确 JTI 的 HTTP 并发审计核验记为 `AUDIT_READ=PASS`。第 3 节旧数据库脚本输出的 `AUDIT_READ=NOT_RUN` 是另一条合成授权的历史状态，不得改写为 PASS。

## 完成边界

保留审计记录供核验；不得自动删除或批量清理。先前隔离数据库测试已记录签发、TLS、Writer 权限、双连接并发消费和完成操作 **PASS**；本轮仅更新文档，未重新运行这些测试。精确 JTI `71108f00-6048-43b3-9677-9b50dffeb0e6` 的 HTTP 并发与审计核验为 **PASS**（`AUDIT_READ=PASS`）。其他未单独提供证据的 HTTP 场景、跨用户 HTTP 验收及完整 Preview 验收仍为 **NOT RUN**；本次核验也不构成 Migration 执行记录及完整对象权限的独立复核。今后的数据库写入、Migration、账号登录和 HTTP 调用仍须另行授权并通过环境门禁；离线测试不构成 Preview 验收证据。
