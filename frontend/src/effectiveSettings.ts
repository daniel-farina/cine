import { normalizeKeyframeSettings } from "./keyframeSettings";
import { DEFAULT_SCENE_COUNT, type PlanningMode } from "./planningModes";
import { normalizeSystemRules, rulesForPrompt } from "./systemRules";
import type { AppSettings, Config, KeyframeSettings, Project } from "./types";

export type EffectiveSettings = {
  keyframeSettings: KeyframeSettings;
  systemRules: string[];
  plannerMode: PlanningMode;
  defaultSceneCount: number;
  bridgeEditPrompt?: string;
  motionRules?: string;
};

export function effectiveSettings(
  project: Project | null,
  studio: AppSettings | null,
  config: Config
): EffectiveSettings {
  const studioKs = normalizeKeyframeSettings(studio?.keyframeSettings, config);
  const projectKs = normalizeKeyframeSettings(project?.keyframeSettings, config);
  const keyframeSettings = project?.keyframeSettings ? projectKs : studioKs;

  const rules = rulesForPrompt(
    normalizeSystemRules(
      project?.systemRules?.length ? project.systemRules : studio?.systemRules
    )
  );

  return {
    keyframeSettings,
    systemRules: rules,
    plannerMode: project?.plannerMode ?? studio?.plannerMode ?? "cinematic",
    defaultSceneCount: studio?.defaultSceneCount ?? DEFAULT_SCENE_COUNT,
    bridgeEditPrompt: project?.bridgeEditPrompt?.trim() || studio?.bridgeEditPrompt?.trim() || undefined,
    motionRules: project?.motionRules?.trim() || studio?.motionRules?.trim() || undefined,
  };
}

export function normalizeProject(project: Project, studio: AppSettings | null): Project {
  return {
    ...project,
    systemRules: normalizeSystemRules(
      project.systemRules?.length ? project.systemRules : studio?.systemRules
    ),
    keyframeSettings: project.keyframeSettings ?? studio?.keyframeSettings,
  };
}