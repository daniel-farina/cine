import type { VideoSource } from "./types";

type Props = {
  sceneId: string;
  sceneIndex: number;
  selected: VideoSource;
  disabled?: boolean;
  hasOpeningStill?: boolean;
  onChange: (source: VideoSource) => void;
};

const SCENE1_OPTIONS: { id: VideoSource; label: string; hint: string; icon: string }[] = [
  {
    id: "text",
    label: "AI opening still",
    hint: "2K + grok-imagine-image-quality from scene prompts, then 1.5-preview video.",
    icon: "✦",
  },
  {
    id: "upload",
    label: "Upload opening still",
    hint: "Your image becomes the first frame (required before YOLO).",
    icon: "↑",
  },
  {
    id: "image",
    label: "From keyframe tab",
    hint: "Use a still you already generated or picked on the Keyframe tab.",
    icon: "▣",
  },
];

const LATER_OPTIONS: { id: VideoSource; label: string; hint: string; icon: string }[] = [
  {
    id: "image",
    label: "From keyframe",
    hint: "Animate the bridged or generated keyframe still.",
    icon: "▣",
  },
];

export default function VideoSourcePicker({
  sceneId,
  sceneIndex,
  selected,
  disabled,
  hasOpeningStill,
  onChange,
}: Props) {
  const options = sceneIndex === 0 ? SCENE1_OPTIONS : LATER_OPTIONS;

  return (
    <section className="method-picker video-source-picker" aria-labelledby={`vs-heading-${sceneId}`}>
      <div className="method-picker-header">
        <div>
          <h3 id={`vs-heading-${sceneId}`} className="method-picker-title">
            {sceneIndex === 0 ? "Scene 1 first frame" : "Clip source"}
          </h3>
          <p className="hint method-picker-sub">
            {sceneIndex === 0
              ? "Pick how Scene 1 gets its first frame before grok-imagine-video-1.5-preview."
              : "This scene uses the keyframe from the bridge step."}
          </p>
        </div>
      </div>
      {sceneIndex === 0 ? (
        <div
          className={`method-group-list video-source-list${options.length === 3 ? " video-source-list-3" : ""}`}
        >
          {options.map((opt) => {
            const isSelected = selected === opt.id;
            const recommended = opt.id === "text";
            const needsUpload = opt.id === "upload" && isSelected && !hasOpeningStill;
            return (
              <button
                key={opt.id}
                type="button"
                className={`method-card${isSelected ? " is-selected" : ""}`}
                disabled={disabled}
                aria-pressed={isSelected}
                onClick={() => onChange(opt.id)}
              >
                <span className="method-card-icon" aria-hidden>
                  {opt.icon}
                </span>
                <span className="method-card-body">
                  <strong>{opt.label}</strong>
                  <span className="method-card-hint">{opt.hint}</span>
                  {needsUpload && (
                    <span className="method-card-lock">Upload below before YOLO</span>
                  )}
                </span>
                {recommended && <span className="method-card-badge">Default</span>}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="hint">Keyframe → video after the previous scene bridge.</p>
      )}
    </section>
  );
}