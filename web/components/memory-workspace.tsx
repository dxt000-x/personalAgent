"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  memoryCategories,
  type Memory,
  type MemoryCategory,
  type MemoryImportance,
} from "@/lib/memories/types";

type MemoryForm = {
  content: string;
  category: MemoryCategory;
  importance: MemoryImportance;
};

type ApiError = { error?: { code?: string; message?: string } };

const categoryLabels: Record<MemoryCategory, string> = {
  preference: "偏好 · Preference",
  profile: "个人资料 · Profile",
  goal: "目标 · Goal",
  work: "工作 · Work",
  study: "学习 · Study",
  habit: "习惯 · Habit",
  other: "其他 · Other",
};

const emptyForm: MemoryForm = { content: "", category: "other", importance: 3 };
const maxMemoriesPerUser = 200;

export function MemoryWorkspace() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<MemoryForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<MemoryForm>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const active = useRef(false);
  const loadGeneration = useRef(0);
  const loadController = useRef<AbortController | null>(null);
  const actionController = useRef<AbortController | null>(null);
  const actionPending = useRef(false);

  const loadMemories = useCallback(async () => {
    if (!active.current) return;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    const generation = ++loadGeneration.current;
    setLoadState("loading");
    setLoadError("");
    try {
      const response = await fetch("/api/memories", { cache: "no-store", signal: controller.signal });
      const body: unknown = await response.json();
      if (!active.current || generation !== loadGeneration.current) return;
      if (!response.ok) throw new Error(getApiMessage(body, response.status));
      const items = typeof body === "object" && body !== null ? (body as { memories?: unknown }).memories : undefined;
      if (!Array.isArray(items)) throw new Error("暂时无法读取个人记忆。");
      setMemories(items as Memory[]);
      setLoadState("ready");
    } catch (error) {
      if (!active.current || generation !== loadGeneration.current) return;
      setLoadError(error instanceof Error ? error.message : "暂时无法读取个人记忆。");
      setLoadState("error");
    } finally {
      if (loadController.current === controller) loadController.current = null;
    }
  }, []);

  useEffect(() => {
    active.current = true;
    let current = true;
    void Promise.resolve().then(() => { if (current) void loadMemories(); });
    return () => {
      current = false;
      active.current = false;
      loadGeneration.current += 1;
      loadController.current?.abort();
      actionController.current?.abort();
    };
  }, [loadMemories]);

  async function addMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active.current || actionPending.current || loadState !== "ready" || memories.length >= maxMemoriesPerUser) return;
    actionPending.current = true;
    const controller = new AbortController();
    actionController.current = controller;
    setBusy(true);
    setNotice("");
    setActionError("");
    try {
      const response = await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
        signal: controller.signal,
      });
      const body: unknown = await response.json();
      if (!active.current) return;
      if (!response.ok) throw new Error(getApiMessage(body, response.status));
      const created = (body as { memory: Memory }).memory;
      setMemories((current) => [created, ...current]);
      setForm(emptyForm);
      setNotice("个人记忆已添加。");
    } catch (error) {
      if (active.current) setActionError(error instanceof Error ? error.message : "添加失败，请稍后重试。");
    } finally {
      if (actionController.current === controller) actionController.current = null;
      actionPending.current = false;
      if (active.current) setBusy(false);
    }
  }

  function beginEdit(memory: Memory) {
    setEditingId(memory.id);
    setEditForm({ content: memory.content, category: memory.category, importance: memory.importance });
    setActionError("");
    setNotice("");
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingId || !active.current || actionPending.current) return;
    actionPending.current = true;
    const controller = new AbortController();
    actionController.current = controller;
    setBusy(true);
    setNotice("");
    setActionError("");
    try {
      const response = await fetch(`/api/memories/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
        signal: controller.signal,
      });
      const body: unknown = await response.json();
      if (!active.current) return;
      if (!response.ok) throw new Error(getApiMessage(body, response.status));
      const updated = (body as { memory: Memory }).memory;
      setMemories((current) => current.map((memory) => memory.id === updated.id ? updated : memory));
      setEditingId(null);
      setNotice("个人记忆已更新。");
    } catch (error) {
      if (active.current) setActionError(error instanceof Error ? error.message : "保存失败，请稍后重试。");
    } finally {
      if (actionController.current === controller) actionController.current = null;
      actionPending.current = false;
      if (active.current) setBusy(false);
    }
  }

  async function deleteMemory(memory: Memory) {
    if (!active.current || actionPending.current) return;
    if (!window.confirm("确定删除这条个人记忆吗？此操作无法撤销。")) return;
    actionPending.current = true;
    const controller = new AbortController();
    actionController.current = controller;
    setBusy(true);
    setNotice("");
    setActionError("");
    try {
      const response = await fetch(`/api/memories/${memory.id}`, { method: "DELETE", signal: controller.signal });
      if (!active.current) return;
      if (!response.ok) {
        const body: unknown = await response.json();
        if (!active.current) return;
        throw new Error(getApiMessage(body, response.status));
      }
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      if (editingId === memory.id) setEditingId(null);
      setNotice("个人记忆已删除。");
    } catch (error) {
      if (active.current) setActionError(error instanceof Error ? error.message : "删除失败，请稍后重试。");
    } finally {
      if (actionController.current === controller) actionController.current = null;
      actionPending.current = false;
      if (active.current) setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="panel" aria-labelledby="add-memory-title">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-wide text-teal-700">PERSONAL CONTEXT</p>
            <h2 id="add-memory-title" className="mt-2 text-lg font-semibold">添加个人记忆</h2>
            <p className="mt-1 text-sm text-slate-500">内容仅保存到当前登录账号的个人空间。</p>
          </div>
          <span className="badge">用户保存</span>
        </div>
        <form onSubmit={addMemory} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_190px_140px_auto] lg:items-end">
          <label className="block text-sm font-medium text-slate-700">
            内容
            <textarea
              aria-label="内容"
              required
              maxLength={2000}
              rows={3}
              value={form.content}
              onChange={(event) => setForm({ ...form, content: event.target.value })}
              placeholder="记录值得长期保留的信息……"
              className="mt-2 min-h-24 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal leading-6 outline-none focus:border-teal-700"
            />
            <span className="mt-1 block text-right text-xs font-normal text-slate-400">{form.content.length}/2000</span>
          </label>
          <CategorySelect value={form.category} onChange={(category) => setForm({ ...form, category })} />
          <ImportanceSelect value={form.importance} onChange={(importance) => setForm({ ...form, importance })} />
          <button className="button-primary h-11" type="submit" disabled={busy || loadState !== "ready" || memories.length >= maxMemoriesPerUser}>＋ 添加记忆</button>
        </form>
        {loadState === "ready" && memories.length >= maxMemoriesPerUser && (
          <p className="mt-3 text-sm text-amber-700" role="status">已达到 200 条上限，请先删除不再需要的记忆。</p>
        )}
      </section>

      <div aria-live="polite" className="space-y-3">
        {notice && <p className="rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-800">{notice}</p>}
        {actionError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{actionError}</p>}
      </div>

      <section aria-labelledby="memory-list-title">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-wide text-slate-400">YOUR PRIVATE MEMORY</p>
            <h2 id="memory-list-title" className="mt-2 text-xl font-semibold">个人记忆</h2>
          </div>
          {loadState === "ready" && <span className="text-sm text-slate-500">{memories.length} / {maxMemoriesPerUser} 条</span>}
        </div>

        {loadState === "loading" && (
          <div className="panel text-sm text-slate-500" role="status">正在读取你的个人记忆…</div>
        )}
        {loadState === "error" && (
          <div className="panel" role="alert">
            <p className="text-sm text-rose-700">{loadError}</p>
            <button className="button-secondary mt-4" type="button" onClick={() => void loadMemories()}>重试</button>
          </div>
        )}
        {loadState === "ready" && memories.length === 0 && (
          <div className="panel border-dashed text-center">
            <p className="text-base font-medium text-slate-700">还没有个人记忆</p>
            <p className="mt-2 text-sm text-slate-500">添加第一条记忆，开始建立你的 Personal Context。</p>
          </div>
        )}
        {loadState === "ready" && memories.length > 0 && (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {memories.map((memory) => (
              <article key={memory.id} className="panel flex flex-col">
                {editingId === memory.id ? (
                  <form onSubmit={saveEdit} className="flex h-full flex-col gap-4">
                    <h3 className="font-semibold">编辑个人记忆</h3>
                    <label className="text-sm font-medium text-slate-700">
                      内容
                      <textarea required maxLength={2000} rows={5} value={editForm.content} onChange={(event) => setEditForm({ ...editForm, content: event.target.value })} className="mt-2 min-h-28 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal leading-6 outline-none focus:border-teal-700" />
                    </label>
                    <CategorySelect value={editForm.category} onChange={(category) => setEditForm({ ...editForm, category })} />
                    <ImportanceSelect value={editForm.importance} onChange={(importance) => setEditForm({ ...editForm, importance })} />
                    <div className="mt-auto flex gap-2 pt-2">
                      <button className="button-primary" type="submit" disabled={busy}>保存修改</button>
                      <button className="button-secondary" type="button" disabled={busy} onClick={() => setEditingId(null)}>取消</button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <span className="badge">{categoryLabels[memory.category]}</span>
                      <span className="text-xs text-amber-600">重要度 {memory.importance}/5</span>
                    </div>
                    <p className="mt-4 flex-1 whitespace-pre-wrap text-sm leading-7 text-slate-600">{memory.content}</p>
                    <dl className="mt-5 space-y-2 border-t border-slate-100 pt-4 text-xs text-slate-400">
                      <div className="flex justify-between gap-3"><dt>创建时间</dt><dd>{formatDate(memory.created_at, true)}</dd></div>
                      <div className="flex justify-between gap-3"><dt>更新时间</dt><dd>{formatDate(memory.updated_at, true)}</dd></div>
                      <div className="flex justify-between gap-3"><dt>来源</dt><dd>{memory.source === "manual" ? "用户保存" : memory.source}</dd></div>
                    </dl>
                    <div className="mt-5 flex gap-2">
                      <button className="button-secondary" type="button" disabled={busy} onClick={() => beginEdit(memory)}>编辑</button>
                      <button className="button-secondary" type="button" disabled={busy} onClick={() => void deleteMemory(memory)}>删除</button>
                    </div>
                  </>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CategorySelect({ value, onChange }: { value: MemoryCategory; onChange: (value: MemoryCategory) => void }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      类别
      <select value={value} onChange={(event) => onChange(event.target.value as MemoryCategory)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-700">
        {memoryCategories.map((category) => <option key={category} value={category}>{categoryLabels[category]}</option>)}
      </select>
    </label>
  );
}

function ImportanceSelect({ value, onChange }: { value: MemoryImportance; onChange: (value: MemoryImportance) => void }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      重要度
      <select value={value} onChange={(event) => onChange(Number(event.target.value) as MemoryImportance)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-700">
        {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} · {value === 5 ? "非常重要" : value === 1 ? "较低" : "一般"}</option>)}
      </select>
    </label>
  );
}

function getApiMessage(body: unknown, status: number): string {
  const error = typeof body === "object" && body !== null ? (body as ApiError).error : undefined;
  if (error?.code === "AUTH_REQUIRED" || status === 401) return "登录状态已失效，请重新登录后继续。";
  if (error?.code === "MEMORY_LIMIT_REACHED") return "个人记忆已达到 200 条上限，请先删除不再需要的记忆。";
  if (typeof error?.message === "string") return error.message;
  return "请求未能完成，请稍后重试。";
}

function formatDate(value: string, withSeconds = false): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: withSeconds ? "medium" : "short",
  }).format(date);
}
