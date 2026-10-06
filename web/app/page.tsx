const plannedFeatures = [
  { title: "Personal Agent", description: "协助安排学习与工作任务，提供个性化支持。" },
  { title: "Memory / RAG", description: "在用户授权下管理记忆，检索个人知识。" },
  { title: "Models / Tools", description: "接入模型路由与工具，连接云端和本地能力。" },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-16 text-slate-900 sm:px-10">
      <div className="mx-auto max-w-4xl">
        <header className="border-b border-slate-200 pb-12">
          <p className="mb-6 text-sm font-semibold tracking-widest text-teal-700">DAY 1 / TASK 1</p>
          <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">Personal AI Assistant</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
            面向大学生和年轻职场人的 Web Personal AI Agent，让学习与工作更有条理。
          </p>
          <p className="mt-8 inline-block rounded-full bg-teal-100 px-4 py-2 text-sm font-medium text-teal-900">
            当前阶段：基础架构
          </p>
        </header>

        <section aria-labelledby="implemented-heading" className="py-10">
          <h2 id="implemented-heading" className="text-xl font-semibold">已实现</h2>
          <p className="mt-3 leading-7 text-slate-600">
            Next.js Web 应用、TypeScript、Tailwind CSS 与 App Router 基础页面。
            本页面用于验证项目可运行，尚未接入 AI 或数据服务。
          </p>
        </section>

        <section aria-labelledby="planned-heading">
          <h2 id="planned-heading" className="text-xl font-semibold">Planned Features</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            {plannedFeatures.map((feature) => (
              <article key={feature.title} className="rounded-2xl border border-slate-200 bg-white p-6">
                <p className="text-xs font-semibold text-slate-500">计划中</p>
                <h3 className="mt-3 font-semibold">{feature.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{feature.description}</p>
              </article>
            ))}
          </div>
        </section>
        <footer className="mt-12 text-sm text-slate-500">AI 应用比赛项目 · 基础架构阶段</footer>
      </div>
    </main>
  );
}
