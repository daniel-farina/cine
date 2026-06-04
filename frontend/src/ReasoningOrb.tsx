import { useEffect, useRef, useState } from "react";
import { lastPhrase } from "./reasoningPhrase";

type Props = {
  reasoning: string;
  active: boolean;
};

export function ReasoningOrb({ reasoning, active }: Props) {
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const phrase = lastPhrase(reasoning) || "Thinking…";

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [reasoning, expanded]);

  useEffect(() => {
    if (!active) setExpanded(false);
  }, [active]);

  if (!active) return null;

  return (
    <div className={`reasoning-panel${expanded ? " is-expanded" : ""}`}>
      <div
        className="reasoning-progress"
        role="progressbar"
        aria-valuetext="Planning in progress"
        aria-busy="true"
      >
        <div className="reasoning-progress__track">
          <div className="reasoning-progress__fill" />
        </div>
      </div>

      <button
        type="button"
        className="reasoning-panel__head"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <span className="reasoning-panel__label">Reasoning</span>
        <span className="reasoning-panel__phrase">{phrase}</span>
        <span className="reasoning-panel__chevron" aria-hidden>
          {expanded ? "▾" : "▸"}
        </span>
      </button>

      <div ref={scrollRef} className="reasoning-panel__body">
        <div className="reasoning-panel__content">
          {reasoning.trim() ? (
            <pre className="reasoning-panel__text">{reasoning}</pre>
          ) : (
            <p className="reasoning-panel__placeholder">Waiting for tokens…</p>
          )}
        </div>
      </div>
    </div>
  );
}