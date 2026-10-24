import { describe, expect, it } from "vitest";
import {
  MAX_PLAN_STEPS,
  buildPlanningInstruction,
  parseAgentPlanText,
} from "./planning";

describe("agent planning", () => {
  it("parses a valid plan", () => {
    const plan = parseAgentPlanText(JSON.stringify({
      version: 1,
      goal: "完成项目当前阶段的开发",
      steps: [
        {
          id: "step-1",
          title: "检查当前状态",
          description: "确认现有功能和测试结果。",
          status: "pending",
        },
        {
          id: "step-2",
          title: "制定下一步方案",
          description: "根据检查结果确定实施顺序。",
          status: "pending",
        },
      ],
      requiresConfirmation: true,
    }));

    expect(plan).not.toBeNull();
    expect(plan?.steps).toHaveLength(2);
    expect(plan?.requiresConfirmation).toBe(true);
  });

  it("accepts a concise three-day learning plan", () => {
    const plan = parseAgentPlanText(JSON.stringify({
      version: 1,
      goal: "三天学习 TypeScript",
      steps: ["基础语法", "类型与函数", "练习与复盘"].map((title, index) => ({
        id: `step-${index + 1}`, title, description: `第 ${index + 1} 天完成${title}。`, status: "pending",
      })),
      requiresConfirmation: true,
    }));
    expect(plan?.steps).toHaveLength(3);
    expect(plan?.steps.map((step) => step.title)).toEqual(["基础语法", "类型与函数", "练习与复盘"]);
  });

  it("still accepts a complex task with all eight necessary steps", () => {
    const plan = parseAgentPlanText(JSON.stringify({
      version: 1,
      goal: "完成复杂项目交付",
      steps: Array.from({ length: MAX_PLAN_STEPS }, (_, index) => ({
        id: `step-${index + 1}`,
        title: `阶段 ${index + 1}`,
        description: `完成阶段 ${index + 1} 的必要检查。`,
        status: "pending",
      })),
      requiresConfirmation: true,
    }));
    expect(plan?.steps).toHaveLength(MAX_PLAN_STEPS);
  });

  it("accepts a JSON code fence", () => {
    const plan = parseAgentPlanText(`\`\`\`json
{
  "version": 1,
  "goal": "测试任务",
  "steps": [
    {
      "id": "step-1",
      "title": "执行检查",
      "description": "检查当前状态。",
      "status": "pending"
    }
  ],
  "requiresConfirmation": true
}
\`\`\``);

    expect(plan?.goal).toBe("测试任务");
  });

  it("rejects invalid JSON", () => {
    expect(parseAgentPlanText("")).toBeNull();
    expect(parseAgentPlanText("   ")).toBeNull();
    expect(parseAgentPlanText("不是 JSON")).toBeNull();
    expect(parseAgentPlanText('{"version":1,"goal":"三天学习计划","steps":[')).toBeNull();
  });

  it("rejects a plan without confirmation", () => {
    expect(parseAgentPlanText(JSON.stringify({
      version: 1,
      goal: "测试",
      steps: [{
        id: "step-1",
        title: "检查",
        description: "检查当前状态。",
        status: "pending",
      }],
      requiresConfirmation: false,
    }))).toBeNull();
  });

  it("rejects more than the allowed number of steps", () => {
    const steps = Array.from({ length: MAX_PLAN_STEPS + 1 }, (_, index) => ({
      id: `step-${index + 1}`,
      title: "步骤",
      description: "执行该步骤。",
      status: "pending",
    }));

    expect(parseAgentPlanText(JSON.stringify({
      version: 1,
      goal: "测试",
      steps,
      requiresConfirmation: true,
    }))).toBeNull();
  });

  it("does not accept tool-like execution fields as required plan structure", () => {
    const plan = parseAgentPlanText(JSON.stringify({
      version: 1,
      goal: "测试",
      steps: [{
        id: "step-1",
        title: "执行操作",
        description: "执行该步骤。",
        status: "pending",
        tool: "shell",
      }],
      requiresConfirmation: true,
    }));

    expect(plan).toEqual({
      version: 1,
      goal: "测试",
      steps: [{
        id: "step-1",
        title: "执行操作",
        description: "执行该步骤。",
        status: "pending",
      }],
      requiresConfirmation: true,
    });
  });
});

describe("planning instruction", () => {
  it("requires JSON-only confirmed plans", () => {
    const instruction = buildPlanningInstruction();

    expect(instruction).toContain("只能输出 JSON，且必须紧凑、完整");
    expect(instruction).toContain("直接给出结果，不展开推理、背景说明");
    expect(instruction).toContain("requiresConfirmation");
    expect(instruction).toContain("不得自行保存 Memory");
    expect(instruction).toContain("不得输出 shell 命令");
    expect(instruction).toContain("三天学习计划通常按每天一步");
    expect(instruction).toContain("复杂任务不能为求简短而遗漏必要阶段");
    expect(instruction).toContain("不重复目标、背景或其他步骤");
    expect(instruction).toContain("只输出上述字段组成的完整 JSON");
  });
});
