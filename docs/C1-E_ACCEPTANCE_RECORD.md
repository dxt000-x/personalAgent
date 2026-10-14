# C1-E Memory 隔离验收记录

## 范围与基线

- 测试项目：`personal-agent-quota-test`。
- Supabase Project Ref：`pxfaqcepztzqyqtmbdrf`（维护者已确认以此前核验值为准）。
- 代码基线：`main`，`40cca3a673c695f7bd7cfb9071b2cc5e3c2eee5d`。
- 验收环境：本地应用 `http://localhost:3109`，连接独立测试 Supabase 项目。以下 C1-E A/B 与 Agent 结果依据维护者提供的脱敏执行摘要归档；本轮文档整理没有重新登录、查询数据库或调用模型。既有 B1、B2 或生产环境结果不自动视为本轮 C1-E 验收结果。

## 已有证据与结果

| 验收项 | 结果 | 证据范围 |
| --- | --- | --- |
| Memory Migration | PASS | C1-E 阶段 1 已在上述独立测试项目执行 `20261007160000_create_memories.sql`。执行后只读核验确认 `public.memories` 存在、RLS 开启、SELECT/INSERT/UPDATE/DELETE 四类用户所属策略及相应授权存在；当时未创建测试 Memory。 |
| 普通 A/B 账号登录 | PASS（维护者报告） | 维护者分别以 A、B 登录本地测试应用并执行下述隔离步骤；本记录不包含账号标识或会话凭据。 |
| Memory A/B 直接访问隔离 | PASS（维护者报告） | A 创建 Memory 后，B 的列表不显示该记录；B 使用 A 的 Memory ID 执行 GET、PATCH、DELETE 均无法取得或更改 A 的记录。维护者未提供各次 HTTP 状态码，本轮未独立重放。 |
| Knowledge A/B 搜索隔离 | PASS（维护者报告） | A、B 分别创建测试文档并以关键词搜索；各自仅获得本人文档，维护者未发现跨用户文档泄露。既有 B1 双向隔离结果是独立的历史证据。 |
| Agent + Memory/Knowledge 联合验收 | PASS（维护者报告） | Agent 正常调用 Memory；启用知识库检索时返回当前用户对应文档。维护者未发现跨用户上下文污染。本项证明所述隔离流程，不评价真实模型回答质量。 |

## 历史诊断与最终结论

早前一次本地 Memory 创建请求在 `assertSameOrigin()` 被拒绝：服务端识别的请求 origin 为 `http://localhost:3109`，浏览器发送的 Origin 为 `http://127.0.0.1:3109`。该次 HTTP 400 未进入数据库写入。后续维护者改用统一的 `localhost:3109` 完成了上述验收；临时诊断代码已恢复，主仓库业务代码未修改。

**C1-E 用户隔离验收结论：PASS（维护者确认）。** 该结论限于上述测试项目、本地应用、当次 A/B 会话及测试数据；本轮只归档维护者摘要，没有独立复测。跨账号操作的逐请求状态码、测试文档与 Memory 的精确 ID、测试数据清理结果均未随摘要提供，保持未独立核验，不据此推断生产环境或所有异常场景均已通过。
