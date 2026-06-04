type Props = {
  value: number;
  label?: string;
  active?: boolean;
};

const CELLS = 28;

export function PixelProgress({ value, label, active }: Props) {
  const filled = Math.round(Math.min(1, Math.max(0, value)) * CELLS);
  const pulseIndex = active && filled < CELLS ? filled : -1;

  return (
    <div
      className={`pixel-progress${active ? " is-active" : ""}`}
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="pixel-progress__track">
        {Array.from({ length: CELLS }, (_, i) => (
          <span
            key={i}
            className={[
              "pixel-progress__cell",
              i < filled ? "on" : "",
              i === pulseIndex ? "pulse" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          />
        ))}
      </div>
      {label ? <p className="pixel-progress__label">{label}</p> : null}
    </div>
  );
}