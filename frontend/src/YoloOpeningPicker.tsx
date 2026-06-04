import type { VideoSource } from "./types";

type Props = {
  selected: VideoSource;
  disabled?: boolean;
  onChange: (mode: VideoSource) => void;
};

const OPTIONS: { id: VideoSource; label: string; hint: string }[] = [
  {
    id: "text",
    label: "AI opening still",
    hint: "Scene 1: max-quality still from prompts, then video.",
  },
  {
    id: "upload",
    label: "Your opening image",
    hint: "Upload in the panel below or when YOLO prompts you.",
  },
];

/** Scene 1 first-frame choice for YOLO (before or after plan). */
export default function YoloOpeningPicker({ selected, disabled, onChange }: Props) {
  return (
    <div className="yolo-opening-picker" role="group" aria-label="Scene 1 opening for YOLO">
      <span className="yolo-opening-label">Scene 1</span>
      {OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          className={`btn btn-ghost btn-xs yolo-opening-btn${selected === opt.id ? " is-selected" : ""}`}
          disabled={disabled}
          aria-pressed={selected === opt.id}
          title={opt.hint}
          onClick={() => onChange(opt.id)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}