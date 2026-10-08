"use client";

import { useState } from "react";

const models = ["Auto", "OpenAI", "DeepSeek", "Gemini", "Ollama", "OpenRouter"];
const levels = [
  { name: "Answer only", description: "仅回答问题，不执行操作。" },
  { name: "Ask before actions", description: "在执行操作前询问用户。" },
  {
    name: "Automatically perform safe actions",
    description: "自动执行安全操作。",
  },
  {
    name: "High privilege actions require confirmation",
    description: "高权限操作需要用户确认。",
  },
];

export function SettingsPanel() {
  const [model, setModel] = useState("Auto");
  const [level, setLevel] = useState(2);

  return (
    <div className="grid items-start gap-6 xl:grid-cols-2">
      <section className="panel">
        <p className="text-xs text-slate-400">MODELS</p>
        <h2 className="mt-1 text-lg font-semibold">模型选择</h2>
        <p className="mt-2 text-xs leading-6 text-slate-400">
          此处仅演示选择样式；实际 Provider 配置与可用性请在 Agent 页面查看。
        </p>
        <fieldset className="mt-5 space-y-2">
          <legend className="sr-only">演示模型选择</legend>
          {models.map((name) => (
            <label
              key={name}
              className={`flex items-center justify-between gap-3 rounded-xl border p-4 ${model === name ? "border-teal-700 bg-teal-50" : "border-slate-200"}`}
            >
              <span className="flex items-center gap-3 text-sm">
                <input
                  type="radio"
                  name="model"
                  value={name}
                  checked={model === name}
                  onChange={() => setModel(name)}
                  className="accent-teal-800"
                />
                {name}
              </span>
              <span className="text-xs text-slate-400">
                演示选项
              </span>
            </label>
          ))}
        </fieldset>
      </section>
      <section className="panel">
        <p className="text-xs text-slate-400">API PROVIDERS</p>
        <h2 className="mt-1 text-lg font-semibold">API 服务商</h2>
        <p className="mt-2 text-xs leading-6 text-slate-400">
          此处展示服务商，不收集 API Key；实际状态请在 Agent 页面查看。
        </p>
        <ul className="mt-5 divide-y divide-slate-100">
          {["OpenAI", "DeepSeek", "Gemini", "OpenRouter"].map((provider) => (
            <li
              key={provider}
              className="flex items-center justify-between gap-3 py-4"
            >
              <span className="text-sm font-medium">{provider}</span>
              <span className="badge">Agent 页面查看</span>
            </li>
          ))}
        </ul>
        <button disabled className="button-secondary mt-5">
          配置服务商 · Coming Soon
        </button>
      </section>
      <section className="panel">
        <p className="text-xs text-slate-400">AGENT AUTONOMY</p>
        <h2 className="mt-1 text-lg font-semibold">自主程度</h2>
        <p className="mt-2 text-xs leading-6 text-slate-400">
          权限策略设计预览，不会启用任何实际操作权限。
        </p>
        <fieldset className="mt-5 space-y-3">
          <legend className="sr-only">演示 Agent 自主程度</legend>
          {levels.map((item, index) => (
            <label
              key={item.name}
              className={`flex items-start gap-3 rounded-xl border p-4 ${level === index + 1 ? "border-teal-700 bg-teal-50" : "border-slate-200"}`}
            >
              <input
                type="radio"
                name="autonomy"
                checked={level === index + 1}
                onChange={() => setLevel(index + 1)}
                className="mt-1 accent-teal-800"
              />
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-teal-700">
                  Level {index + 1}
                </span>
                <span className="mt-1 block text-sm font-medium">
                  {item.name}
                </span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">
                  {item.description}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      </section>
      <section className="panel">
        <p className="text-xs text-slate-400">LOCAL CONNECTOR</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">本地连接器</h2>
          <span className="badge">Disconnected</span>
        </div>
        <p className="mt-3 text-sm leading-7 text-slate-500">
          未来在授权下连接本地环境。当前没有本地服务或连接行为。
        </p>
        <ul className="mt-5 space-y-3">
          {["Local Files", "Ollama", "Command Execution"].map((capability) => (
            <li
              key={capability}
              className="flex justify-between gap-3 rounded-xl bg-slate-50 p-4 text-sm"
            >
              <span>{capability}</span>
              <span className="text-xs text-slate-400">Coming Soon</span>
            </li>
          ))}
        </ul>
        <button disabled className="button-secondary mt-5">
          连接设备 · 尚未开放
        </button>
      </section>
      <p
        role="status"
        className="text-xs leading-6 text-slate-400 xl:col-span-2"
      >
        演示选择：{model} / Level {level}
        。设置仅保存在当前页面状态中，离开或刷新后重置，未发送或持久化。
      </p>
    </div>
  );
}
