type Props = {
  url: string;
  title: string;
  clipWithVideo: number;
  clipCount: number;
  busy?: boolean;
  canStitch?: boolean;
  onFullscreen: () => void;
  onRestitch: () => void;
};

/** Large inline preview of the stitched final movie, shown above the scene timeline. */
export default function FilmPreviewHero({
  url,
  title,
  clipWithVideo,
  clipCount,
  busy,
  canStitch,
  onFullscreen,
  onRestitch,
}: Props) {
  return (
    <section className="film-preview-hero" aria-label="Final movie preview">
      <div className="film-preview-hero__head">
        <div className="film-preview-hero__titles">
          <h2 className="film-preview-hero__label">Final movie</h2>
          <p className="film-preview-hero__meta">
            {title}
            <span className="film-preview-hero__sep"> · </span>
            {clipWithVideo}/{clipCount} scene clips
            {clipWithVideo > 0 && clipWithVideo < clipCount
              ? " (only scenes with video are included)"
              : ""}
          </p>
        </div>
        <div className="film-preview-hero__actions">
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            disabled={busy}
            onClick={onFullscreen}
          >
            Fullscreen
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            disabled={busy || !canStitch}
            onClick={onRestitch}
            title="Re-export after you change scenes or clips"
          >
            Re-export
          </button>
        </div>
      </div>
      <div className="film-preview-hero__stage">
        <video
          className="film-preview-hero__video"
          src={url}
          controls
          playsInline
          preload="metadata"
        />
      </div>
    </section>
  );
}