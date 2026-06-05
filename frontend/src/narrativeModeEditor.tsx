import {
  DEFAULT_NARRATIVE_MODES,
  NARRATIVE_AUTO_ID,
  type NarrativeModeBehavior,
  type NarrativeModeDefinition,
  newCustomNarrativeMode,
  slugifyNarrativeModeId,
} from "./narrativeModes";

const BEHAVIOR_OPTIONS: { id: NarrativeModeBehavior; label: string }[] = [
  { id: "dialogue", label: "Dialogue-driven" },
  { id: "silent", label: "Silent / observational" },
  { id: "nature", label: "Nature / wildlife" },
  { id: "non_dialogue", label: "No dialogue (generic)" },
];

type Props = {
  modes: NarrativeModeDefinition[];
  onChange: (modes: NarrativeModeDefinition[]) => void;
  disabled?: boolean;
};

export default function NarrativeModeEditor({ modes, onChange, disabled }: Props) {
  const patch = (index: number, patch: Partial<NarrativeModeDefinition>) => {
    onChange(modes.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  };

  const remove = (index: number) => {
    if (modes[index]?.id === NARRATIVE_AUTO_ID) return;
    onChange(modes.filter((_, i) => i !== index));
  };

  const add = () => {
    onChange([...modes, newCustomNarrativeMode(modes)]);
  };

  const resetDefaults = () => {
    if (
      !confirm(
        "Reset narrative modes to the built-in list? Custom modes you added will be replaced."
      )
    ) {
      return;
    }
    onChange([...DEFAULT_NARRATIVE_MODES]);
  };

  return (
    <div className="narrative-modes-editor">
      <p className="hint">
        Modes appear in the film brief planner and YOLO. <strong>Auto</strong> picks a mode
        from brief keywords. Custom modes can include planner instructions appended to the AI
        planner.
      </p>
      <ul className="narrative-modes-list">
        {modes.map((mode, i) => {
          const isAuto = mode.id === NARRATIVE_AUTO_ID;
          return (
            <li key={mode.id} className="narrative-modes-item">
              <div className="narrative-modes-item-head">
                <span className="system-rules-num">{i + 1}</span>
                <div className="narrative-modes-fields">
                  <label>
                    Label
                    <input
                      type="text"
                      value={mode.label}
                      disabled={disabled || isAuto}
                      onChange={(e) => patch(i, { label: e.target.value })}
                    />
                  </label>
                  <label>
                    ID
                    <input
                      type="text"
                      value={mode.id}
                      disabled={disabled || isAuto}
                      onBlur={(e) => {
                        const id = slugifyNarrativeModeId(e.target.value || mode.label);
                        if (id && id !== mode.id && !modes.some((m) => m.id === id)) {
                          patch(i, { id });
                        }
                      }}
                      onChange={(e) => patch(i, { id: slugifyNarrativeModeId(e.target.value) })}
                    />
                  </label>
                  <label>
                    Behavior
                    <select
                      value={isAuto ? "auto" : mode.behavior}
                      disabled={disabled || isAuto}
                      onChange={(e) =>
                        patch(i, { behavior: e.target.value as NarrativeModeBehavior })
                      }
                    >
                      {isAuto ? (
                        <option value="auto">Auto (infer from brief)</option>
                      ) : (
                        BEHAVIOR_OPTIONS.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.label}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                </div>
                {!isAuto && (
                  <button
                    type="button"
                    className="project-delete"
                    title="Remove mode"
                    disabled={disabled}
                    onClick={() => remove(i)}
                  >
                    ×
                  </button>
                )}
              </div>
              <label>
                Description (shown in planner dropdown)
                <input
                  type="text"
                  value={mode.description}
                  disabled={disabled || isAuto}
                  onChange={(e) => patch(i, { description: e.target.value })}
                />
              </label>
              {!isAuto && (
                <>
                  <label>
                    Auto-match keywords (comma-separated)
                    <input
                      type="text"
                      value={(mode.inferKeywords || []).join(", ")}
                      disabled={disabled}
                      onChange={(e) =>
                        patch(i, {
                          inferKeywords: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="horror, suspense, creepy"
                    />
                  </label>
                  <label>
                    Planner appendix (optional)
                    <textarea
                      rows={3}
                      value={mode.plannerAppendix || ""}
                      disabled={disabled}
                      onChange={(e) => patch(i, { plannerAppendix: e.target.value })}
                      placeholder="Extra instructions appended when this mode is selected…"
                    />
                  </label>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <div className="system-rules-actions">
        <button type="button" className="btn" disabled={disabled} onClick={add}>
          + Add mode
        </button>
        <button type="button" className="btn btn-ghost" disabled={disabled} onClick={resetDefaults}>
          Reset to defaults
        </button>
      </div>
    </div>
  );
}