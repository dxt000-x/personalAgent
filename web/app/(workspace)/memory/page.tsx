import { MemoryWorkspace } from "@/components/memory-workspace";
import { PageHeader } from "@/components/page-header";

export default function MemoryPage() {
  return (
    <>
      <PageHeader
        eyebrow="PERSONAL CONTEXT"
        title="Personal Memory · 个人记忆"
        description="只属于当前登录账号的长期目标、项目与偏好。"
      />
      <MemoryWorkspace />
    </>
  );
}
