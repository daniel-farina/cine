/** Configurable narrative / planner modes (studio settings). */

export type NarrativeModeBehavior =
  | "auto"
  | "dialogue"
  | "silent"
  | "nature"
  | "non_dialogue";

export type NarrativeModeDefinition = {
  id: string;
  label: string;
  description: string;
  behavior: NarrativeModeBehavior;
  /** Appended to the planner system message when this mode is active. */
  plannerAppendix?: string;
  /** Keywords for Auto mode matching (substring, case-insensitive). */
  inferKeywords?: string[];
};

export const NARRATIVE_AUTO_ID = "auto";

export const DEFAULT_NARRATIVE_MODE = NARRATIVE_AUTO_ID;

/** Built-in + example modes shipped with the studio. */
export const DEFAULT_NARRATIVE_MODES: NarrativeModeDefinition[] = [
  {
    id: NARRATIVE_AUTO_ID,
    label: "Auto",
    description:
      "Infer from brief keywords (coral, wildlife, silent, interview, etc.)",
    behavior: "auto",
  },
  {
    id: "dialogue_driven",
    label: "Dialogue",
    description: "Characters speak; dialogue + alignment passes run",
    behavior: "dialogue",
    inferKeywords: ["dialogue", "conversation", "says", "interview", "banter"],
  },
  {
    id: "silent_observational",
    label: "Silent / observational",
    description: "No speech; protagonist walks, observes, ambient city or mood",
    behavior: "silent",
    inferKeywords: ["silent", "no dialogue", "not talking", "wordless", "stoic"],
  },
  {
    id: "nature_wildlife",
    label: "Nature / wildlife",
    description: "Reef, ocean, animals, macro — no human dialogue",
    behavior: "nature",
    inferKeywords: [
      "underwater",
      "coral",
      "wildlife",
      "reef",
      "fish",
      "documentary",
      "macro",
    ],
  },
  {
    id: "horror_tension",
    label: "Horror / tension",
    description: "Dread and atmosphere; no explanatory dialogue",
    behavior: "non_dialogue",
    inferKeywords: ["horror", "creepy", "dread", "suspense", "haunted"],
    plannerAppendix: `
HORROR / TENSION (overrides default dialogue rhythm):
- Build unease through lighting, sound, and stillness — not characters explaining the plot.
- EVERY shot: shot_kind "transition". dialogue "" on every shot.
- No comic relief banter. action_prompt: slow reveals, shadows, breath, footsteps, environmental cues.`,
  },
  {
    id: "action_spectacle",
    label: "Action / spectacle",
    description: "Stunts, chase energy; minimal talk during set pieces",
    behavior: "non_dialogue",
    inferKeywords: ["action", "chase", "fight", "stunt", "explosion", "parkour"],
    plannerAppendix: `
ACTION / SPECTACLE:
- Prioritize readable physical beats in action_prompt; keep dialogue sparse during set pieces.
- Prefer shot_kind "transition" for pure motion beats; use "dialogue" only when brief demands a spoken line.`,
  },
  {
    id: "comedy_banter",
    label: "Comedy / banter",
    description: "Witty exchanges and character voice",
    behavior: "dialogue",
    inferKeywords: ["comedy", "funny", "banter", "joke", "sitcom"],
    plannerAppendix: `
COMEDY / BANTER:
- Alternate dialogue scenes with short transition beats for physical gags.
- dialogue should be tight, character-specific, and playable on camera.`,
  },
  {
    id: "documentary_interview",
    label: "Documentary / interview",
    description: "Talking heads and explainers",
    behavior: "dialogue",
    inferKeywords: ["documentary", "interview", "expert", "voiceover explains"],
    plannerAppendix: `
DOCUMENTARY / INTERVIEW:
- Use dialogue scenes for subjects speaking to camera or each other.
- scene_prompt: clear subject placement; action_prompt: subtle natural movement while speaking.`,
  },
  {
    id: "music_performance",
    label: "Music / performance",
    description: "Band, dance, stage — performance without scripted dialogue",
    behavior: "non_dialogue",
    inferKeywords: ["concert", "music video", "dance", "performance", "stage"],
    plannerAppendix: `
MUSIC / PERFORMANCE:
- EVERY shot: shot_kind "transition". dialogue "" unless brief names lyrics as on-screen text only.
- action_prompt: choreography, instrument playing, crowd energy — no talking heads.`,
  },
  {
    id: "product_commercial",
    label: "Product / commercial",
    description: "Hero product shots; optional VO, no character dialogue",
    behavior: "non_dialogue",
    inferKeywords: ["product", "commercial", "brand", "logo", "packshot"],
    plannerAppendix: `
PRODUCT / COMMERCIAL:
- Focus on product hero frames, hands-in-use, lifestyle context — not scripted conversations.
- EVERY shot: shot_kind "transition". dialogue "".
- action_prompt: product motion, light sweeps, subtle hand interaction.`,
  },
  {
    id: "travel_montage",
    label: "Travel montage",
    description: "Scenic landmarks and B-roll; wordless journey",
    behavior: "silent",
    inferKeywords: ["travel", "montage", "landmark", "vacation", "aerial city"],
  },
  {
    id: "sports_highlight",
    label: "Sports highlight",
    description: "Athletic motion, arena energy, no play-by-play dialogue",
    behavior: "non_dialogue",
    inferKeywords: ["sports", "athlete", "stadium", "goal", "race"],
    plannerAppendix: `
SPORTS HIGHLIGHT:
- EVERY shot: shot_kind "transition". dialogue "".
- action_prompt: athletic motion, crowd blur, equipment detail — no announcer script in dialogue field.`,
  },
  {
    id: "instructional_howto",
    label: "Instructional / how-to",
    description: "Clear steps with narrator-style dialogue",
    behavior: "dialogue",
    inferKeywords: ["tutorial", "how to", "step by step", "explainer"],
    plannerAppendix: `
INSTRUCTIONAL / HOW-TO:
- dialogue carries the teaching beat; keep lines short and sequential.
- scene_prompt: hands, tools, UI, or subject centered for clarity.`,
  },
  {
    id: "romance_intimate",
    label: "Romance / intimate",
    description: "Emotional two-hander dialogue",
    behavior: "dialogue",
    inferKeywords: ["romance", "love", "date", "intimate", "relationship"],
  },
  {
    id: "sci_fi_epic",
    label: "Sci-fi / epic",
    description: "World-building with selective exposition dialogue",
    behavior: "dialogue",
    inferKeywords: ["sci-fi", "spaceship", "future", "cyberpunk", "alien"],
  },
  {
    id: "historical_drama",
    label: "Historical drama",
    description: "Period dialogue and ceremony",
    behavior: "dialogue",
    inferKeywords: ["historical", "period", "1800s", "medieval", "victorian"],
  },
  {
    id: "kids_family",
    label: "Kids / family",
    description: "Simple, warm dialogue; clear moral beats",
    behavior: "dialogue",
    inferKeywords: ["kids", "family", "children", "wholesome"],
  },
  {
    id: "asmr_sensory",
    label: "ASMR / sensory",
    description: "Macro textures, slow motion, no speech",
    behavior: "nature",
    inferKeywords: ["asmr", "sensory", "texture", "macro", "tapping"],
  },
  {
    id: "fashion_runway",
    label: "Fashion / runway",
    description: "Model motion, fabrics, editorial — no interview dialogue",
    behavior: "non_dialogue",
    inferKeywords: ["fashion", "runway", "couture", "lookbook"],
    plannerAppendix: `
FASHION / RUNWAY:
- EVERY shot: shot_kind "transition". dialogue "".
- action_prompt: walk cycles, fabric flow, detail inserts — no backstage interview lines.`,
  },
  {
    id: "food_macro",
    label: "Food / macro",
    description: "Cooking, steam, plating — appetizing motion without dialogue",
    behavior: "nature",
    inferKeywords: ["food", "cooking", "recipe", "plating", "chef hands"],
  },
  {
    id: "wedding_cinematic",
    label: "Wedding cinematic",
    description: "Vows and crowd as visuals; sparse spoken lines unless brief asks",
    behavior: "silent",
    inferKeywords: ["wedding", "bride", "groom", "ceremony"],
  },
  {
    id: "true_crime",
    label: "True crime / narration",
    description: "Narrator-driven testimony style dialogue",
    behavior: "dialogue",
    inferKeywords: ["true crime", "investigation", "detective", "case file"],
  },
  {
    id: "noir_monologue",
    label: "Noir / voiceover",
    description: "Moody visuals with sparse hard-boiled VO lines",
    behavior: "dialogue",
    inferKeywords: ["noir", "detective", "voiceover", "rain alley"],
    plannerAppendix: `
NOIR / VOICEOVER:
- dialogue as terse VO or one-sided phone booth lines — not group chatter.
- Prefer shadow-heavy scene_prompt and slow action_prompt camera moves.`,
  },
];

export function slugifyNarrativeModeId(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
  return base || "custom_mode";
}

export function normalizeNarrativeModes(
  modes?: NarrativeModeDefinition[] | null
): NarrativeModeDefinition[] {
  if (!modes?.length) return [...DEFAULT_NARRATIVE_MODES];
  const out: NarrativeModeDefinition[] = [];
  const seen = new Set<string>();
  for (const raw of modes) {
    if (!raw || typeof raw !== "object") continue;
    const id = String(raw.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const behavior = (raw.behavior || "dialogue") as NarrativeModeBehavior;
    out.push({
      id,
      label: String(raw.label || id).trim() || id,
      description: String(raw.description || "").trim(),
      behavior: ["auto", "dialogue", "silent", "nature", "non_dialogue"].includes(behavior)
        ? behavior
        : "dialogue",
      plannerAppendix: raw.plannerAppendix?.trim() || undefined,
      inferKeywords: Array.isArray(raw.inferKeywords)
        ? raw.inferKeywords.map((k) => String(k).trim()).filter(Boolean)
        : undefined,
    });
  }
  if (!out.some((m) => m.id === NARRATIVE_AUTO_ID)) {
    out.unshift(DEFAULT_NARRATIVE_MODES[0]);
  }
  return out;
}

export function narrativeModesForSelect(
  modes: NarrativeModeDefinition[]
): NarrativeModeDefinition[] {
  return modes.filter((m) => m.behavior !== "auto" || m.id === NARRATIVE_AUTO_ID);
}

export function isValidNarrativeModeId(
  id: string,
  modes: NarrativeModeDefinition[]
): boolean {
  return modes.some((m) => m.id === id);
}

export function coerceNarrativeModePreference(
  id: string | undefined,
  modes: NarrativeModeDefinition[]
): string {
  const normalized = normalizeNarrativeModes(modes);
  if (id && isValidNarrativeModeId(id, normalized)) return id;
  return DEFAULT_NARRATIVE_MODE;
}

export function newCustomNarrativeMode(
  existing: NarrativeModeDefinition[]
): NarrativeModeDefinition {
  let n = 1;
  let id = "custom_mode";
  while (existing.some((m) => m.id === id)) {
    n += 1;
    id = `custom_mode_${n}`;
  }
  return {
    id,
    label: "Custom mode",
    description: "Describe when to use this mode",
    behavior: "dialogue",
    plannerAppendix: "",
    inferKeywords: [],
  };
}