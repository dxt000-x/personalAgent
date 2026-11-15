import { PageHeader } from "@/components/page-header";
import { SettingsPanel } from "@/components/settings-panel";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="MAKE IT PERSONAL"
        title="Settings · 设置"
        description="查看模型服务配置状态，了解实际能力与设置预览的边界。"
      />
      <SettingsPanel />
    </>
  );
}
