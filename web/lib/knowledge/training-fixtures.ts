import type { KnowledgeDocument } from "./types";
export const trainingOwner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const trainingOther = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const trainingDoc: KnowledgeDocument = { id: "11111111-1111-4111-8111-111111111111", user_id: trainingOwner, file_name: "study.md", file_type: "md", byte_size: 100, storage_path: "synthetic/source.md", status: "ready", failure_kind: null, processing_generation: 1, chunk_count: 1, created_at: "2026-11-15T00:00:00Z", updated_at: "2026-11-15T00:00:00Z" };
export const trainingChunks = ["# 数据库基础\n数据库保存结构化资料。算法描述解决问题的步骤，程序设计将算法写成程序。\n# 概率基础\n概率描述事件发生的可能性。矩阵用于组织数字。"];
