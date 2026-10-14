# B2 Knowledge Base Final Verification

本记录归档维护者确认的 B2 Production 验收结果；本次文档整理未重新执行生产请求。B2 使用现有关键词检索，将当前用户的已就绪片段作为受限引用资料加入 AI Chat，不包含向量检索或语义 RAG。

## 功能范围

- **文档上传与 Storage 保存：**创建当前用户的上传记录后，将 PDF、TXT 或 Markdown 原件保存到私有 `knowledge-files` Bucket。
- **文档处理与文件解析：**通过处理接口认领文档，读取原件并解析可提取的文本；完成后将状态更新为 `ready`，处理失败则按既有状态流程记录。
- **Chunk 生成：**将解析文本分段，并通过受限 Writer 的私有数据库函数写入 `knowledge_chunks`。
- **知识库搜索：**按当前登录用户及 `ready` 状态执行有界关键词检索。
- **Chat Grounding：**用户主动开启知识库并指定关键词后，Chat 将实际选中的片段作为不可信引用资料加入上下文，并返回对应来源；无匹配时不调用模型。

## 验收结果

| 验收项 | 结果 |
| --- | --- |
| Upload | PASS |
| Storage 保存 | PASS |
| Processing | PASS |
| 文件解析与 Chunk 生成 | PASS |
| Ready state | PASS |
| Search | PASS |
| Chat Grounding | PASS |
| Production Verification | PASS |

上述 PASS 为维护者确认的 Production 功能验收结论，不表示本次归档重新执行了生产测试，也不扩展为全部异常恢复或跨账号写操作场景均已验收。

## 问题修复记录

- 排查过知识库 Writer 数据库连接配置导致的服务不可用问题，并核对受限角色的连接链路。
- 排查过公开 Supabase Client 与 Writer 的 Project 配置不一致风险，要求两者指向同一目标项目。
- 修正 `KNOWLEDGE_DB_URL` 的目标项目及受限 Writer 连接配置。
- 修正 TLS/CA 配置，继续验证证书链与主机名。
- 排障期间曾加入固定阶段码诊断日志；问题恢复后，已清理知识库处理、Writer 连接、文档创建和上传路由中的临时日志，并保留安全错误响应。

## 环境注意事项

- Production 使用受限 `knowledge_writer_login`，不以 `service_role` 或管理员连接替代普通用户身份与 RLS 检查。
- Writer 连接的用户名 Project Ref 必须与当前 Production Supabase 项目一致；部署时应分别核对公开客户端与 Writer 的目标项目。
- Writer 的 TLS CA 证书及主机名验证必须保持开启，不得关闭证书验证来绕过连接错误。
- 本记录不包含数据库密码、Secret、API Key、完整连接 URL 或证书内容。
