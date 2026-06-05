import type { TimedProgressPhase } from "./useTimedProgress";

export type ClipJobPhase = Extract<TimedProgressPhase, "image" | "video">;

export type ClipJob = {
  phase: ClipJobPhase;
  progress: number;
  label: string;
  keyframeUrl: string | null;
};

const CAP = 0.94;

export function createClipProgressTicker(
  estimateMs: number,
  onProgress: (progress: number) => void
): () => void {
  const start = Date.now();
  const estimate = Math.max(estimateMs, 4000);
  const id = window.setInterval(() => {
    const elapsed = Date.now() - start;
    onProgress(Math.min(CAP, (elapsed / estimate) * CAP));
  }, 120);
  return () => window.clearInterval(id);
}