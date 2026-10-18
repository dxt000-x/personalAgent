export const MAX_PLAN_STEPS = 8;
export const MAX_PLAN_TASK_CHARS = 1000;
export const MAX_PLAN_GOAL_CHARS = 240;
export const MAX_PLAN_STEP_TITLE_CHARS = 120;
export const MAX_PLAN_STEP_DESCRIPTION_CHARS = 280;

export type AgentPlanStep = {
  id: string;
  title: string;
  description: string;
  status: "pending";
};

export type AgentPlan = {
  version: 1;
  goal: string;
  steps: AgentPlanStep[];
  requiresConfirmation: true;
};

export function buildPlanningInstruction(): string {
  return [
    "你是 Personal AI Assistant 的任务规划模块。",
    "把用户任务拆成简洁、可理解、等待确认的计划。",
    "",
    "严格规则：",
    "1. 只能输出 JSON，不要输出 Markdown、解释文字或代码块。",
    "2. 计划包含 1 到 8 个步骤，只保留完成任务必需的步骤；三天学习计划通常按每天一步，复杂任务不能为求简短而遗漏必要阶段。",
    "3. goal、title 和 description 使用简短、具体的文字；每步 description 只写一句，不重复目标或其他步骤。每步只描述要做什么，不执行操作。",
    "4. 不得虚构已经完成的操作、工具结果、文件内容或外部信息。",
    "5. 不得输出 shell 命令、SQL、API Key、Token、密码或其他凭据。",
    "6. 不得自行保存 Memory、修改 Knowledge Base 或调用工具。",
    "7. requiresConfirmation 必须始终为 true。",
    "",
    "输出紧凑 JSON，不添加空白排版。格式：",
    '{"version":1,"goal":"任务目标","steps":[{"id":"step-1","title":"步骤标题","description":"步骤说明","status":"pending"}],"requiresConfirmation":true}',
  ].join("\n");
}

function unwrapJson(text: string): string {
  const trimmed = text.trim();

  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAgentPlanText(text: string): AgentPlan | null {
  if (!text.trim()) return null;

  let value: unknown;
  try {
    value = JSON.parse(unwrapJson(text)) as unknown;
  } catch {
    return null;
  }

  if (!isRecord(value)
    || value.version !== 1
    || typeof value.goal !== "string"
    || value.goal.trim().length === 0
    || value.goal.length > MAX_PLAN_GOAL_CHARS
    || value.requiresConfirmation !== true
    || !Array.isArray(value.steps)
    || value.steps.length < 1
    || value.steps.length > MAX_PLAN_STEPS) {
    return null;
  }

  const seenIds = new Set<string>();
  const steps: AgentPlanStep[] = [];

  for (const rawStep of value.steps) {
    if (!isRecord(rawStep)
      || typeof rawStep.id !== "string"
      || !/^step-\d+$/u.test(rawStep.id)
      || seenIds.has(rawStep.id)
      || typeof rawStep.title !== "string"
      || rawStep.title.trim().length === 0
      || rawStep.title.length > MAX_PLAN_STEP_TITLE_CHARS
      || typeof rawStep.description !== "string"
      || rawStep.description.trim().length === 0
      || rawStep.description.length > MAX_PLAN_STEP_DESCRIPTION_CHARS
      || rawStep.status !== "pending") {
      return null;
    }

    seenIds.add(rawStep.id);
    steps.push({
      id: rawStep.id,
      title: rawStep.title.trim(),
      description: rawStep.description.trim(),
      status: "pending",
    });
  }

  return {
    version: 1,
    goal: value.goal.trim(),
    steps,
    requiresConfirmation: true,
  };
}
