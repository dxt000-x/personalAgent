"use client";

import { useI18n } from "@/components/i18n-provider";

import Link from "next/link";
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
  const { t, locale, number: formatNumber, errorText } = useI18n();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<MemoryForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<MemoryForm>(emptyForm);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<MemoryCategory | "all">("all");
  const [pendingKind, setPendingKind] = useState<"add" | "edit" | "delete" | null>(null);
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
    setPendingKind("add");
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
      if (active.current) { setBusy(false); setPendingKind(null); }
    }
  }

  function hasUnsavedEdit() {
    const original = memories.find((memory) => memory.id === editingId);
    return !!original && (editForm.content !== original.content || editForm.category !== original.category || editForm.importance !== original.importance);
  }
  function cancelEdit() {
    if (hasUnsavedEdit() && !window.confirm(t("放弃未保存的修改吗？"))) return;
    setEditingId(null);
  }
  function beginEdit(memory: Memory) {
    if (actionPending.current) return;
    if (editingId && editingId !== memory.id && hasUnsavedEdit() && !window.confirm(t("放弃当前未保存的修改并编辑另一条记忆吗？"))) return;
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
    setPendingKind("edit");
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
      if (active.current) { setBusy(false); setPendingKind(null); }
    }
  }

  async function deleteMemory(memory: Memory) {
    if (!active.current || actionPending.current) return;
    if (!window.confirm(t("确定删除这条个人记忆吗？此操作无法撤销。"))) return;
    actionPending.current = true;
    const controller = new AbortController();
    actionController.current = controller;
    setBusy(true);
    setPendingKind("delete");
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
      if (active.current) { setBusy(false); setPendingKind(null); }
    }
  }

  const visibleMemories = memories.filter((memory) =>
    (categoryFilter === "all" || memory.category === categoryFilter)
      && memory.content.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const authRequired = "登录状态已失效，请重新登录后继续。";

  return (
    <div className="space-y-6">
      <section className="panel" aria-labelledby="add-memory-title">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-wide text-teal-700">{t("PERSONAL CONTEXT")}</p>
            <h2 id="add-memory-title" className="mt-2 text-lg font-semibold">{t("添加个人记忆")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("内容仅保存到当前登录账号的个人空间。")}</p>
          </div>
          <span className="badge">{t("用户保存")}</span>
        </div>
        <form onSubmit={addMemory} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_160px_120px_auto] xl:items-end">
          <fieldset disabled={busy} className="contents">
          <label className="block text-sm font-medium text-slate-700 sm:col-span-2 xl:col-span-1">
            {t("内容")}<textarea
              aria-label={t("内容")}
              required
              maxLength={2000}
              rows={3}
              value={form.content}
              onChange={(event) => setForm({ ...form, content: event.target.value })}
              placeholder={t("记录值得长期保留的信息……")}
              className="mt-2 min-h-24 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal leading-6 outline-none focus:border-teal-700"
            />
            <span className="mt-1 block text-right text-xs font-normal text-slate-400">{formatNumber(form.content.length)}/2000</span>
          </label>
          <CategorySelect value={form.category} onChange={(category) => setForm({ ...form, category })} />
          <ImportanceSelect value={form.importance} onChange={(importance) => setForm({ ...form, importance })} />
          <button className="button-primary h-11 sm:col-span-2 sm:justify-self-end xl:col-span-1" type="submit" disabled={busy || loadState !== "ready" || memories.length >= maxMemoriesPerUser}>{pendingKind === "add" ? t("正在添加…") : t("＋ 添加记忆")}</button>
          </fieldset>
        </form>
        {loadState === "ready" && memories.length >= maxMemoriesPerUser && (
          <p className="mt-3 text-sm text-amber-700" role="status">{t("已达到 200 条上限，请先删除不再需要的记忆。")}</p>
        )}
      </section>

      <div aria-live="polite" className="space-y-3">
        {notice && <p className="rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-800">{t(notice)}</p>}
        {actionError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{errorText(actionError)}
          {actionError === authRequired && <Link href="/login" className="ml-2 underline">{t("重新登录")}</Link>}
        </div>}
        {pendingKind === "delete" && <p role="status" className="text-sm text-slate-500">{t("正在删除个人记忆…")}</p>}
      </div>

      <section aria-labelledby="memory-list-title">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-wide text-slate-400">{t("YOUR PRIVATE MEMORY")}</p>
            <h2 id="memory-list-title" className="mt-2 text-xl font-semibold">{t("个人记忆")}</h2>
          </div>
          {loadState === "ready" && <span className="text-sm text-slate-500">{formatNumber(memories.length)} / {maxMemoriesPerUser} {" "}{t("条")}</span>}
        </div>

        <div className="mb-4 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">{t("搜索记忆")}<input type="search" value={query} maxLength={200} disabled={busy || editingId !== null}
              onChange={(event) => setQuery(event.target.value)} placeholder={t("在已加载的记忆中查找文字")}
              className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"/>
          </label>
          <label className="text-sm font-medium text-slate-700">{t("按类别筛选")}<select value={categoryFilter} disabled={busy || editingId !== null} onChange={(event) => setCategoryFilter(event.target.value as MemoryCategory | "all")}
              className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
              <option value="all">{t("全部类别")}</option>{memoryCategories.map((category) => <option key={category} value={category}>{t(categoryLabels[category])}</option>)}
            </select>
          </label>
          <p className="text-xs leading-5 text-slate-500 sm:col-span-2">{t("仅筛选当前账号已加载的记录。编辑时暂停筛选，保存或取消后可继续。")}</p>
        </div>
        {loadState === "loading" && (
          <div className="panel min-h-40 text-sm text-slate-500" role="status">{t("正在读取你的个人记忆…")}</div>
        )}
        {loadState === "error" && (
          <div className="panel" role="alert">
            <p className="text-sm text-rose-700">{errorText(loadError)}</p>
            {loadError === authRequired ? <Link href="/login" className="button-secondary mt-4">{t("重新登录")}</Link>
              : <button className="button-secondary mt-4" type="button" onClick={() => void loadMemories()}>{t("重试")}</button>}
          </div>
        )}
        {loadState === "ready" && memories.length === 0 && (
          <div className="panel border-dashed text-center">
            <p className="text-base font-medium text-slate-700">{t("还没有个人记忆")}</p>
            <p className="mt-2 text-sm text-slate-500">{t("添加第一条记忆，开始建立你的 Personal Context。")}</p>
          </div>
        )}
        {loadState === "ready" && memories.length > 0 && visibleMemories.length === 0 && <div className="panel text-center">
          <p className="text-sm text-slate-600">{t("没有匹配的记忆，请调整关键词或类别。")}</p>
          <button type="button" className="button-secondary mt-4" onClick={() => { setQuery(""); setCategoryFilter("all"); }}>{t("清除筛选")}</button>
        </div>}
        {loadState === "ready" && visibleMemories.length > 0 && (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {visibleMemories.map((memory) => (
              <article key={memory.id} className="panel flex min-w-0 flex-col">
                {editingId === memory.id ? (
                  <form onSubmit={saveEdit} className="flex h-full flex-col gap-4">
                    <h3 className="font-semibold">{t("编辑个人记忆")}</h3>
                    <p className="text-xs leading-5 text-slate-500">{t("修改尚未保存。点击“保存修改”后才会更新记录。")}</p>
                    <fieldset disabled={busy} className="contents">
                    <label className="text-sm font-medium text-slate-700">
                      {t("内容")}<textarea autoFocus required maxLength={2000} rows={5} value={editForm.content} onChange={(event) => setEditForm({ ...editForm, content: event.target.value })} className="mt-2 min-h-28 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal leading-6 outline-none focus:border-teal-700" />
                    </label>
                    <CategorySelect value={editForm.category} onChange={(category) => setEditForm({ ...editForm, category })} />
                    <ImportanceSelect value={editForm.importance} onChange={(importance) => setEditForm({ ...editForm, importance })} />
                    <div className="mt-auto flex flex-wrap gap-2 pt-2">
                      <button className="button-primary" type="submit" disabled={busy}>{pendingKind === "edit" ? t("正在保存…") : t("保存修改")}</button>
                      <button className="button-secondary" type="button" disabled={busy} onClick={cancelEdit}>{t("取消")}</button>
                    </div>
                    </fieldset>
                  </form>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="badge">{t(categoryLabels[memory.category])}</span>
                      <span className="text-xs text-amber-600">{t("重要度")}{" "}{formatNumber(memory.importance)}/5</span>
                    </div>
                    <p className="mt-4 flex-1 whitespace-pre-wrap text-sm leading-7 text-slate-600">{memory.content}</p>
                    <dl className="mt-5 space-y-2 border-t border-slate-100 pt-4 text-xs text-slate-400">
                      <div className="flex justify-between gap-3"><dt>{t("创建时间")}</dt><dd>{formatDate(memory.created_at, true, locale)}</dd></div>
                      <div className="flex justify-between gap-3"><dt>{t("更新时间")}</dt><dd>{formatDate(memory.updated_at, true, locale)}</dd></div>
                      <div className="flex justify-between gap-3"><dt>{t("来源")}</dt><dd>{memory.source === "manual" ? t("用户保存") : memory.source}</dd></div>
                    </dl>
                    <div className="mt-5 flex flex-wrap gap-2">
                      <button className="button-secondary" type="button" disabled={busy} onClick={() => beginEdit(memory)}>{t("编辑")}</button>
                      <button className="button-secondary" type="button" disabled={busy} onClick={() => void deleteMemory(memory)}>{t("删除")}</button>
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
  const { t } = useI18n();
  return (
    <label className="block text-sm font-medium text-slate-700">
      {t("类别")}<select value={value} onChange={(event) => onChange(event.target.value as MemoryCategory)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-700">
        {memoryCategories.map((category) => <option key={category} value={category}>{t(categoryLabels[category])}</option>)}
      </select>
    </label>
  );
}

function ImportanceSelect({ value, onChange }: { value: MemoryImportance; onChange: (value: MemoryImportance) => void }) {
  const { t } = useI18n();
  return (
    <label className="block text-sm font-medium text-slate-700">
      {t("重要度")}<select value={value} onChange={(event) => onChange(Number(event.target.value) as MemoryImportance)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-700">
        {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} · {value === 5 ? t("非常重要") : value === 1 ? t("较低") : t("一般")}</option>)}
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

function formatDate(value: string, withSeconds = false, locale: "zh-CN" | "en" = "zh-CN"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: withSeconds ? "medium" : "short",
  }).format(date);
}
