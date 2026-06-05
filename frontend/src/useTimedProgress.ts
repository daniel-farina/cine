import { useCallback, useEffect, useRef, useState } from "react";

const TICK_MS = 120;
const CAP_BEFORE_DONE = 0.94;

export type TimedProgressPhase = "image" | "video" | "stitch" | null;

export function useTimedProgress() {
  const [progress, setProgress] = useState(0);
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<TimedProgressPhase>(null);
  const [label, setLabel] = useState("");
  const startRef = useRef(0);
  const estimateRef = useRef(60_000);
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearFinishTimer = useCallback(() => {
    if (finishTimerRef.current) {
      window.clearTimeout(finishTimerRef.current);
      finishTimerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    clearFinishTimer();
    setActive(false);
    setPhase(null);
    setLabel("");
    setProgress(0);
  }, [clearFinishTimer]);

  const start = useCallback(
    (p: NonNullable<TimedProgressPhase>, estimateMs: number, phaseLabel: string) => {
      clearFinishTimer();
      estimateRef.current = Math.max(estimateMs, 4000);
      startRef.current = Date.now();
      setPhase(p);
      setLabel(phaseLabel);
      setProgress(0);
      setActive(true);
    },
    [clearFinishTimer]
  );

  /** End of a chained phase (e.g. image → video); keeps overlay active. */
  const pulsePhase = useCallback(() => {
    setProgress(1);
    window.setTimeout(() => setProgress(0), 180);
  }, []);

  /** All work done — dismiss overlay after a short beat. */
  const finish = useCallback(() => {
    clearFinishTimer();
    setProgress(1);
    finishTimerRef.current = window.setTimeout(() => {
      setActive(false);
      setPhase(null);
      setLabel("");
      finishTimerRef.current = null;
    }, 400);
  }, [clearFinishTimer]);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const ratio = elapsed / estimateRef.current;
      setProgress(Math.min(CAP_BEFORE_DONE, ratio * CAP_BEFORE_DONE));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [active]);

  useEffect(() => () => clearFinishTimer(), [clearFinishTimer]);

  return { progress, active, phase, label, start, pulsePhase, finish, stop };
}