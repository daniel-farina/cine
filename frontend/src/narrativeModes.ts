/** How the planner treats dialogue vs silent / nature footage. */

export type NarrativeModePreference =
  | "auto"
  | "dialogue_driven"
  | "silent_observational"
  | "nature_wildlife";

export type NarrativeModeInfo = {
  id: NarrativeModePreference;
  label: string;
  description: string;
};

export const NARRATIVE_MODE_OPTIONS: NarrativeModeInfo[] = [
  {
    id: "auto",
    label: "Auto",
    description: "Infer from brief (coral, wildlife, macro → nature; no speech cues → silent)",
  },
  {
    id: "dialogue_driven",
    label: "Dialogue",
    description: "Characters speak; dialogue + alignment passes run",
  },
  {
    id: "silent_observational",
    label: "Silent",
    description: "No speech or conversations; ambient motion only",
  },
  {
    id: "nature_wildlife",
    label: "Nature / wildlife",
    description: "Underwater, reef, animals — no human dialogue",
  },
];

export const DEFAULT_NARRATIVE_MODE: NarrativeModePreference = "auto";