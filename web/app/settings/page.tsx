import { PageHeader } from "@/components/page-header";
import { SettingsPanel } from "@/components/settings-panel";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="MAKE IT PERSONAL"
        title="Settings · 设置"
        description="配置未来的模型、Agent 自主程度与本地能力。当前仅为 UI 演示。"
      />
      <SettingsPanel />
    </>
  );
}
