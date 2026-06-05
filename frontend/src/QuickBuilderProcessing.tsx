import { PixelProgress } from "./PixelProgress";
import type { TimedProgressPhase } from "./useTimedProgress";

type Props = {
  active: boolean;
  phase: TimedProgressPhase;
  progress: number;
  label: string;
  keyframeUrl?: string | null;
  onStop?: () => void;
};

const PHASE_COPY: Record<NonNullable<TimedProgressPhase>, string> = {
  image: "Rendering opening still",
  video: "Synthesizing motion",
  stitch: "Stitching clips",
};

export default function QuickBuilderProcessing({
  active,
  phase,
  progress,
  label,
  keyframeUrl,
  onStop,
}: Props) {
  if (!active || !phase) return null;

  const headline = label || PHASE_COPY[phase];
  const pct = Math.round(progress * 100);
  const showThumb = Boolean(keyframeUrl && phase === "video");

  return (
    <div
      className={`qb-processing${showThumb ? " qb-processing--with-thumb" : ""}`}
      aria-busy="true"
      aria-live="polite"
    >
      {keyframeUrl && showThumb && (
        <>
          <img className="qb-processing-bg-blur" src={keyframeUrl} alt="" aria-hidden />
          <div className="qb-processing-thumb-wrap">
            <img className="qb-processing-thumb" src={keyframeUrl} alt="Opening still" />
          </div>
        </>
      )}

      {!showThumb && (
        <>
          <div className="qb-processing-scan" aria-hidden />
          <div className="qb-processing-grain" aria-hidden />
          <div className="qb-processing-orb" aria-hidden>
            <span className="qb-processing-orb-core" />
            <span className="qb-processing-orb-ring" />
            <span className="qb-processing-orb-ring qb-processing-orb-ring--delay" />
          </div>
        </>
      )}

      <div className="qb-processing-content">
        <div className="qb-processing-top">
          <p className="qb-processing-phase">{headline}</p>
          {onStop && (
            <button type="button" className="btn btn-stop-qb" onClick={onStop}>
              Stop
            </button>
          )}
        </div>
        <div className="qb-processing-bar-track">
          <div
            className="qb-processing-bar-fill"
            style={{ width: `${Math.max(4, pct)}%` }}
          />
        </div>
        <PixelProgress value={progress} label={`${pct}% · est. from last ${phase} run`} active />
        <p className="hint qb-processing-hint">
          {phase === "image"
            ? "Building your keyframe…"
            : phase === "video"
              ? keyframeUrl
                ? "Animating from your still — this usually takes a minute or two."
                : "This usually takes a minute or two."
              : "Crossfading selected clips…"}
        </p>
      </div>
    </div>
  );
}