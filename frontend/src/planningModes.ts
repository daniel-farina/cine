export type PlanningMode = "quick" | "cinematic" | "deep" | "multi_agent" | "multi_agent_deep";

export type PlanningModeInfo = {
  id: PlanningMode;
  label: string;
  description: string;
};

export const PLANNING_MODES: PlanningModeInfo[] = [
  { id: "quick", label: "Quick", description: "grok-4.3 · fast breakdown" },
  { id: "cinematic", label: "Cinematic", description: "grok-4.3 · balanced story flow" },
  { id: "deep", label: "Deep", description: "grok-4.3 · careful continuity" },
  { id: "multi_agent", label: "Multi-agent (4)", description: "4 agents collaborate" },
  { id: "multi_agent_deep", label: "Multi-agent (16)", description: "16 agents · complex stories" },
];

export const SCENE_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10, 12] as const;
export const DEFAULT_SCENE_COUNT = 12 as const;