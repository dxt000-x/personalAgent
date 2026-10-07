export const memoryCategories = [
  "preference",
  "profile",
  "goal",
  "work",
  "study",
  "habit",
  "other",
] as const;

export type MemoryCategory = (typeof memoryCategories)[number];
export type MemoryImportance = 1 | 2 | 3 | 4 | 5;

export type Memory = {
  id: string;
  user_id: string;
  content: string;
  category: MemoryCategory;
  importance: MemoryImportance;
  source: "manual" | "agent" | "conversation" | "imported";
  created_at: string;
  updated_at: string;
};

export type CreateMemoryInput = {
  content: string;
  category: MemoryCategory;
  importance: MemoryImportance;
};

export type UpdateMemoryInput = Partial<CreateMemoryInput>;
