import {
  availableKeyframeMethods,
  isMethodDisabled,
  methodsByGroup,
  type KeyframeMethodDef,
  type KeyframeMethodContext,
} from "./keyframeMethods";
import type { KeyframeSource } from "./types";

const METHOD_ICONS: Partial<Record<KeyframeSource, string>> = {
  prompt: "✦",
  upload: "↑",
  edit_existing: "✎",
  hd_existing: "HD",
  reuse_prev_keyframe: "⎘",
  last_frame_hd: "←",
  last_frame: "←",
  first_frame_prev: "⏮",
  self_last_frame_hd: "↻",
  self_last_frame: "↻",
  gallery: "▦",
};

type Props = {
  sceneId: string;
  sceneIndex: number;
  selected: KeyframeSource;
  methodCtx: KeyframeMethodContext;
  disabled?: boolean;
  includeGroups?: KeyframeMethodDef["group"][];
  title?: string;
  subtitle?: string;
  onChange: (id: KeyframeSource) => void;
  onUploadClick?: () => void;
};

function disabledReason(
  m: ReturnType<typeof availableKeyframeMethods>[0],
  ctx: KeyframeMethodContext
): string | null {
  if (!m.requiresApiKey || ctx.hasApiKey) {
    if (!m.requiresPrevVideo || ctx.canUsePrevVideo) {
      if (!m.requiresPrevKeyframe || ctx.prevKeyframeId) {
        if (!m.requiresOwnVideo || ctx.canUseOwnVideo) {
          if (!m.requiresOwnKeyframe || ctx.hasKeyframe) return null;
          return "Needs a keyframe on this scene";
        }
        return "Generate video on this scene first";
      }
      return "Previous scene needs a keyframe";
    }
    return "Finish the previous scene’s video first";
  }
  return "Add XAI_API_KEY in .env";
}

export default function KeyframeMethodPicker({
  sceneId,
  sceneIndex,
  selected,
  methodCtx,
  disabled,
  includeGroups,
  title = "Keyframe method",
  subtitle = "Choose how this scene gets its still — then run the action below.",
  onChange,
  onUploadClick,
}: Props) {
  const all = availableKeyframeMethods(methodCtx);
  const methods = includeGroups
    ? all.filter((m) => includeGroups.includes(m.group))
    : all;
  const groups = methodsByGroup(methods);

  return (
    <section className="method-picker" aria-labelledby={`kf-heading-${sceneId}`}>
      <div className="method-picker-header">
        <div>
          <h3 id={`kf-heading-${sceneId}`} className="method-picker-title">
            {title}
          </h3>
          <p className="hint method-picker-sub">{subtitle}</p>
        </div>
        <span className="method-picker-count">{methods.length} options</span>
      </div>

      <div className="method-picker-scroll">
        {methods.length === 0 && (
          <p className="hint method-picker-empty">No methods in this step for this scene.</p>
        )}
        {groups.map((g) => (
          <div key={g.group} className="method-group">
            <p className="method-group-label">{g.label}</p>
            <div className="method-group-list">
              {g.items.map((m) => {
                const off = isMethodDisabled(m, methodCtx);
                const isSelected = selected === m.id;
                const reason = off ? disabledReason(m, methodCtx) : null;
                const recommended =
                  sceneIndex > 0 && m.id === "last_frame_hd" && !off;

                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`method-card${isSelected ? " is-selected" : ""}${off ? " is-disabled" : ""}`}
                    disabled={disabled || off}
                    aria-pressed={isSelected}
                    onClick={() => {
                      onChange(m.id);
                      if (m.id === "upload") onUploadClick?.();
                    }}
                  >
                    <span className="method-card-icon" aria-hidden>
                      {METHOD_ICONS[m.id] ?? "•"}
                    </span>
                    <span className="method-card-body">
                      <strong>{m.label}</strong>
                      <span className="method-card-hint">{m.hint}</span>
                      {reason && <span className="method-card-lock">{reason}</span>}
                    </span>
                    {recommended && (
                      <span className="method-card-badge">Default</span>
                    )}
                    {m.usesUploadZone && isSelected && (
                      <span className="method-card-badge">Drop below</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {includeGroups?.includes("previous") &&
          sceneIndex > 0 &&
          !methodCtx.canUsePrevVideo && (
            <p className="hint method-warn">
              Bridge options unlock after the previous scene has a finished video.
            </p>
          )}
      </div>
    </section>
  );
}