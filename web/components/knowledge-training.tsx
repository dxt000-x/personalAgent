"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "./i18n-provider";
import { createClient } from "@/lib/supabase/client";
import { domainLabels, domains } from "@/lib/knowledge/classification-types";
import { gradeTrainingAnswer, isTrainingPack, trainingQuestions, trainingStats, type TrainingPack, type TrainingMode, type TrainingCatalogItem, type TrainingAttempt } from "@/lib/knowledge/training-types";
const modeLabels: Record<TrainingMode, string> = { learn: "知识点学习", cards: "问答卡片", test: "章节测试", wrong: "错题复习", random: "随机抽题", category: "分类专项训练" };
type Session = { learned: string[]; attempts: Record<string, TrainingAttempt> };
const emptySession = (): Session => ({ learned: [], attempts: {} });
export function KnowledgeTraining({ userId }: { userId: string }) {
  const { t, number } = useI18n();
  const [items, setItems] = useState<TrainingCatalogItem[]>([]), [offset, setOffset] = useState<number | null>(0);
  const [domain, setDomain] = useState(""), [topic, setTopic] = useState("");
  const [pack, setPack] = useState<TrainingPack | null>(null), [sessions, setSessions] = useState<Record<string, Session>>({});
  const [mode, setMode] = useState<TrainingMode>("learn"), [queue, setQueue] = useState<string[]>([]), [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState(""), [checked, setChecked] = useState(false), [revealed, setRevealed] = useState(false);
  const [useAi, setUseAi] = useState(false), [busy, setBusy] = useState(false), [catalogBusy, setCatalogBusy] = useState(false), [error, setError] = useState("");
  const alive = useRef(true), blocked = useRef(false), busyRef = useRef(false), catalogRef = useRef<AbortController | null>(null), version = useRef(0), requests = useRef(new Set<AbortController>());
  const session = pack ? sessions[pack.id] ?? emptySession() : emptySession();
  const updateSession = (change: (s: Session) => Session) => { if (pack) setSessions(all => ({ ...all, [pack.id]: change(all[pack.id] ?? emptySession()) })); };
  const resetQuestion = () => { setAnswer(""); setChecked(false); setRevealed(false); };
  const load = useCallback(async (next = 0) => {
    if (catalogRef.current && !catalogRef.current.signal.aborted || blocked.current) return; setCatalogBusy(true); setError("");
    const controller = new AbortController(); catalogRef.current = controller; requests.current.add(controller);
    try {
      const r = await fetch(`/api/knowledge/training?offset=${next}`, { cache: "no-store", signal: controller.signal });
      if (!r.ok) throw Error(); const body = await r.json();
      if (!alive.current || blocked.current || controller.signal.aborted) return;
      if (body.ownerId !== userId) { blocked.current = true;setPack(null);setSessions({});setItems([]);setError("登录身份已改变，请重新进入训练页面。");return; }
      if (!Array.isArray(body.items) || body.items.length > 10 || ![null, next + 10].includes(body.nextOffset)
        || body.items.some((d: TrainingCatalogItem) => !d || typeof d.id !== "string" || !/^[a-f0-9-]{36}$/iu.test(d.id) || typeof d.fileName !== "string" || !domains.includes(d.domain) || !Array.isArray(d.topics) || d.topics.some(x => typeof x !== "string") || typeof d.unavailable !== "boolean")) throw Error();
      if (!alive.current || blocked.current || controller.signal.aborted) return;
      setItems(old => next === 0 ? body.items : [...old, ...body.items.filter((d: TrainingCatalogItem) => !old.some(o => o.id === d.id))]);setOffset(body.nextOffset);
    } catch { if (alive.current && !blocked.current && !controller.signal.aborted) setError("训练内容读取失败，请检查登录或网络后重试。"); }
    finally { requests.current.delete(controller); if (catalogRef.current === controller) { catalogRef.current = null;if (alive.current) setCatalogBusy(false); } }
  }, [userId]);
  useEffect(() => {
    alive.current = true;let mounted = true;const controllers = requests.current;
    Promise.resolve().then(() => { if (mounted) void load(); });
    const client = createClient(); const subscription = client?.auth.onAuthStateChange((_event, auth) => {
      if (!auth || auth.user.id !== userId) { blocked.current = true; for (const c of requests.current) c.abort();setPack(null);setSessions({});setItems([]);setError("登录身份已改变，请重新进入训练页面。"); }
    });
    return () => { mounted = false;alive.current = false; for (const c of controllers) c.abort();subscription?.data.subscription.unsubscribe(); };
  }, [load, userId]);
  const topics = [...new Set(items.filter(d => !domain || d.domain === domain).flatMap(d => d.topics))];
  const visible = items.filter(d => (!domain || d.domain === domain) && (!topic || d.topics.includes(topic)));
  async function generate(id: string) {
    if (busyRef.current || blocked.current) return;busyRef.current = true;setBusy(true);setError("");
    const currentVersion = version.current;const c = new AbortController();requests.current.add(c);
    try {
      const r = await fetch("/api/knowledge/training", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId: id, useLocalAi: useAi }), signal: c.signal });
      if (!r.ok) throw Error();const body = await r.json();
      if (!alive.current || blocked.current || c.signal.aborted || currentVersion !== version.current) return;
      if (typeof body.pack?.ownerId === "string" && body.pack.ownerId !== userId) { blocked.current = true;setPack(null);setSessions({});setItems([]);setError("登录身份已改变，请重新进入训练页面。");return; }
      if (!isTrainingPack(body.pack, userId) || body.pack.documentId !== id) throw Error();
      if (!alive.current || blocked.current || c.signal.aborted || currentVersion !== version.current) return;
      setPack(body.pack);setMode("learn");setQueue([]);setIndex(0);resetQuestion();
    } catch { if (alive.current && !blocked.current && !c.signal.aborted) setError("训练生成失败，请检查文档状态后重试。"); }
    finally { requests.current.delete(c);busyRef.current = false;if (alive.current) setBusy(false); }
  }
  const stats = pack ? trainingStats(pack, session.attempts, session.learned) : null;
  const points = pack?.points.filter(p => !topic || p.topic === topic) ?? [];
  const current = pack?.questions.find(q => q.id === queue[index]);
  const currentPoint = current ? pack?.points.find(p => p.id === current.pointId) : points[index];
  const outcome = current ? session.attempts[current.id] : undefined;
  const source = currentPoint && pack ? <details className="mt-4 rounded-xl bg-slate-50 p-4"><summary className="min-h-11 cursor-pointer font-medium">{t("查看原文与来源")}</summary><p className="mt-2 break-all text-xs text-slate-500">{pack.fileName} · {t("文档处理版本")} {number(pack.generation)} · {t("片段")} {number(currentPoint.chunkIndex + 1)} · {number(currentPoint.start)}–{number(currentPoint.end)}</p><blockquote className="mt-3 whitespace-pre-wrap break-words text-sm">{currentPoint.quote}</blockquote><Link href={`/knowledge#knowledge-document-${pack.documentId}`} className="mt-3 inline-flex min-h-11 items-center text-sm text-teal-800 underline">{t("返回原始文档")}</Link></details> : null;
  function start(nextMode: TrainingMode) {
    if (!pack) return;setMode(nextMode);setIndex(0);resetQuestion();
    setQueue(trainingQuestions(pack, nextMode, topic, session.attempts).map(q => q.id));
  }
  function submit() {
    if (!current || checked || !answer.trim()) return;
    updateSession(s => ({ ...s, attempts: { ...s.attempts, [current.id]: { answer, correct: gradeTrainingAnswer(current, answer) } } }));setChecked(true);
  }
  // Locale changes translate labels in place; source text and answers remain untouched.
  const weak = useMemo(() => pack ? trainingStats(pack, sessions[pack.id]?.attempts ?? {}, sessions[pack.id]?.learned ?? []).weakPointIds : [], [pack, sessions]);
  return <section className="min-w-0 space-y-5" aria-label={t("知识训练工作区")}>
    <div className="rounded-2xl border border-teal-100 bg-teal-50 p-4 text-sm text-teal-950"><p>{t("学习记录仅保留在当前页面会话；刷新或离开页面后清除，不会永久保存。")}</p><p className="mt-2">{t("规则分类仅用于训练筛选，不保存或覆盖人工分类。")}</p><p className="mt-2">{t("训练使用生成时的原文快照；文档更新后请重新生成。")}</p></div>
    <div className="flex flex-wrap gap-3"><Link href="/knowledge" className="button-secondary min-h-11">{t("管理知识库")}</Link><Link href="/agent" className="button-secondary min-h-11">{t("打开 Agent 工作区")}</Link><button className="button-secondary min-h-11" onClick={() => { version.current++;setSessions({});setPack(null);setQueue([]);resetQuestion(); }}>{t("清空训练会话")}</button></div>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{t(error)}</p>}
    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
      <aside className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">{t("选择学习文档")}</h2>
        <label className="block text-sm">{t("知识领域")}<select className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 p-2" value={domain} onChange={e => { setDomain(e.target.value);setTopic("");setIndex(0);setMode("learn");setPack(null);resetQuestion(); }}><option value="">{t("全部分类")}</option>{domains.map(d => <option key={d} value={d}>{t(domainLabels[d])}</option>)}</select></label>
        <label className="block text-sm">{t("主题")}<select className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 p-2" value={topic} onChange={e => { setTopic(e.target.value);setIndex(0);setMode("learn");resetQuestion(); }}><option value="">{t("全部主题")}</option>{topics.map(x => <option key={x}>{x}</option>)}</select></label>
        <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-1 size-4" checked={useAi} onChange={e => setUseAi(e.target.checked)} />{t("使用本地 AI 辅助选题（仅 Ollama，不发送到云端）")}</label>
        <p className="text-xs text-slate-500">{t("分类与主题筛选作用于已加载的文档。")}</p>
        {catalogBusy && <p role="status" className="min-h-11 text-sm">{t("正在读取训练文档…")}</p>}
        {!catalogBusy && !visible.length && <p className="text-sm text-slate-500">{t("没有可训练文档；请上传并完成解析，或调整分类筛选。")}</p>}
        <ul className="space-y-2">{visible.map(d => <li key={d.id}><button disabled={busy || d.unavailable} onClick={() => void generate(d.id)} aria-pressed={pack?.documentId === d.id} className="min-h-11 w-full min-w-0 rounded-xl border border-slate-200 px-3 py-3 text-left text-sm hover:bg-teal-50 disabled:opacity-50"><span className="block break-all font-medium">{d.fileName}</span><span className="block text-xs text-slate-500">{d.unavailable ? t("原文暂不可用") : t(domainLabels[d.domain])}</span></button></li>)}</ul>
        <button disabled={catalogBusy || busy} onClick={() => void load(offset ?? 0)} className="button-secondary min-h-11 w-full">{offset !== null && items.length ? t("读取更多文档") : t("刷新文档")}</button>
      </aside>
      <div className="min-h-80 min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6" aria-busy={busy}>
        {busy ? <p role="status" className="min-h-64">{t("正在生成带来源的训练内容…")}</p> : !pack ? <div className="py-12 text-center"><h2 className="text-lg font-semibold">{t("从一份文档开始学习")}</h2><p className="mt-3 text-sm text-slate-500">{t("选择左侧已就绪文档，生成知识点、问答卡片和练习。")}</p></div> : <>
          <h2 className="break-all text-lg font-semibold">{pack.fileName}</h2><p className="mt-2 text-xs text-slate-500">{pack.engine === "ollama" ? t("本地 AI 已辅助安排学习顺序；答案均来自原文。") : t("规则生成；题目与答案关联原文，不代表模型训练或微调。")}</p>
          {pack.aiFallback && <p role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm">{t("本地 AI 不可用或返回无效结果，已回退规则生成。")}</p>}
          <details className="mt-4 rounded-xl bg-slate-50 p-4"><summary className="min-h-11 cursor-pointer font-medium">{t("核心概念摘要（原文摘录）")}</summary><ul className="mt-3 space-y-3">{pack.points.slice(0, 3).map(p => <li key={p.id} className="break-words text-sm"><strong>{p.term}</strong><p className="mt-1 whitespace-pre-wrap">{p.quote}</p></li>)}</ul></details>
          <dl className="my-5 grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm"><div><dt>{t("已学习知识点")}</dt><dd className="mt-1 font-semibold">{number(stats!.learned)} / {number(pack.points.length)}</dd></div><div><dt>{t("自动判分正确率")}</dt><dd className="mt-1 font-semibold">{stats!.graded ? number(stats!.correct / stats!.graded, { style: "percent" }) : "—"}</dd></div><div><dt>{t("错题数量")}</dt><dd className="mt-1 font-semibold">{number(stats!.wrong)}</dd></div><div><dt>{t("训练完成情况")}</dt><dd className="mt-1 font-semibold">{number(stats!.answered)} / {number(stats!.total)}</dd></div></dl>
          <p className="mb-4 text-xs text-slate-500">{t("薄弱知识点")}: {weak.length ? pack.points.filter(p => weak.includes(p.id)).map(p => p.term).join(" · ") : t("暂无记录")}</p>
          <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label={t("训练模式")}>{(Object.keys(modeLabels) as TrainingMode[]).map(m => <button key={m} onClick={() => start(m)} aria-pressed={mode === m} className={`min-h-11 rounded-xl border px-3 py-2 text-sm ${mode === m ? "border-teal-700 bg-teal-50 text-teal-900" : "border-slate-200"}`}>{t(modeLabels[m])}</button>)}</div>
          {!pack.points.length ? <p>{t("原文没有足够的安全可用内容，请选择其他文档。")}</p> : mode === "learn" || mode === "cards" ? <>
            {currentPoint ? <><p className="text-xs text-slate-500">{number(index + 1)} / {number(points.length)}</p><h3 className="mt-3 break-words font-semibold">{currentPoint.term}</h3><p className="mt-3 text-sm text-slate-500">{t("该知识点在原文中如何描述？")}</p>
              {mode === "learn" || revealed ? <blockquote className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4">{currentPoint.quote}</blockquote> : <button className="button-secondary mt-4 min-h-11" onClick={() => setRevealed(true)}>{t("显示参考答案")}</button>}
              <div className="mt-4 flex flex-wrap gap-2"><button className="button-primary min-h-11" disabled={session.learned.includes(currentPoint.id)} onClick={() => updateSession(s => ({ ...s, learned: [...s.learned, currentPoint.id] }))}>{t(session.learned.includes(currentPoint.id) ? "已学习" : "标记已学习")}</button><button className="button-secondary min-h-11" disabled={index === 0} onClick={() => { setIndex(i => i - 1);resetQuestion(); }}>{t("上一项")}</button><button className="button-secondary min-h-11" disabled={index + 1 >= points.length} onClick={() => { setIndex(i => i + 1);resetQuestion(); }}>{t("下一项")}</button></div>{source}</> : <p>{t("当前主题没有知识点，请调整筛选。")}</p>}
          </> : current ? <>
            <p className="text-xs text-slate-500">{number(index + 1)} / {number(queue.length)} · {t(current.kind === "choice" ? "单选题" : current.kind === "boolean" ? "判断题" : "简答题")}</p>
            <h3 className="my-3 font-semibold">{t(current.kind === "choice" ? "选择能还原摘录空白的原文词语。" : current.kind === "boolean" ? "以下摘录是否与文档原文逐字一致？" : "请概述该知识点在原文中的描述。")}</h3><p className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4">{current.excerpt}</p>
            <fieldset disabled={checked} className="mt-4 space-y-2"><legend className="sr-only">{t("你的答案")}</legend>{current.kind === "short" ? <textarea aria-label={t("你的答案")} maxLength={2000} value={answer} onChange={e => setAnswer(e.target.value)} className="min-h-28 w-full rounded-xl border border-slate-300 p-3" /> : (current.kind === "choice" ? current.options : [{ id: "true", term: t("一致") }, { id: "false", term: t("不一致") }]).map(o => <label key={o.id} className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 p-3"><input type="radio" name={current.id} value={o.id} checked={answer === o.id} onChange={() => setAnswer(o.id)} />{o.term || t("以上均不匹配")}</label>)}</fieldset>
            <button className="button-primary mt-4 min-h-11" disabled={checked || !answer.trim()} onClick={submit}>{t("核对答案")}</button>
            {checked && <div role="status" className="mt-4 rounded-xl border border-teal-100 p-4"><p className="font-semibold">{t(current.kind === "short" ? "简答题请对照原文自评，不纳入自动正确率。" : outcome?.correct ? "回答正确" : "需要复习")}</p><h4 className="mt-3 text-sm font-semibold">{t("参考答案与解析：以原文为依据")}</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm">{current.explanation}</p>{current.kind === "short" && <div className="mt-3 flex flex-wrap gap-2">{[true, false].map(ok => <button key={String(ok)} className="button-secondary min-h-11" aria-pressed={outcome?.selfAssessment === ok} onClick={() => updateSession(s => ({ ...s, attempts: { ...s.attempts, [current.id]: { ...s.attempts[current.id], selfAssessment: ok } } }))}>{t(ok ? "自评掌握" : "加入错题")}</button>)}</div>}</div>}
            <button className="button-secondary mt-4 ml-2 min-h-11" onClick={() => { setIndex(i => i + 1);resetQuestion(); }}>{t("下一题")}</button>{source}
          </> : <div role="status"><p>{t(mode === "wrong" && !queue.length ? "暂无待复习错题；完成练习后可回来复习。" : "本组题目已浏览完，可重新开始补答。")}</p><button className="button-secondary mt-4 min-h-11" onClick={() => start(mode)}>{t("重新开始本组")}</button></div>}
        </>}
      </div>
    </div>
  </section>;
}
