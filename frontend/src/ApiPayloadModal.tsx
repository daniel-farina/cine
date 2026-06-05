import { useCallback, useState } from "react";
import { formatPayloadJson, type VideoApiPayload } from "./videoApiPayload";

type Props = {
  open: boolean;
  title: string;
  payload: VideoApiPayload | null;
  onClose: () => void;
};

export default function ApiPayloadModal({ open, title, payload, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(formatPayloadJson(payload));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, [payload]);

  if (!open) return null;

  return (
    <div className="api-payload-modal" role="dialog" aria-modal="true" aria-labelledby="api-payload-title">
      <button type="button" className="api-payload-backdrop" aria-label="Close" onClick={onClose} />
      <div className="api-payload-panel">
        <header className="api-payload-head">
          <h2 id="api-payload-title">{title}</h2>
          <div className="api-payload-head-actions">
            <button type="button" className="btn btn-ghost" disabled={!payload} onClick={() => void copy()}>
              {copied ? "Copied" : "Copy JSON"}
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </header>
        {payload?.note && <p className="hint api-payload-note">{payload.note}</p>}
        <p className="hint api-payload-hint">
          <strong>client</strong> — body Cine received from the UI.{" "}
          <strong>xai</strong> — body sent to xAI <code>/videos/generations</code> (large image
          base64 is shortened in the log).
        </p>
        <pre className="api-payload-json">
          {payload ? formatPayloadJson(payload) : "No payload available."}
        </pre>
      </div>
    </div>
  );
}