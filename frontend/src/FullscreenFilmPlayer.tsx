import { useEffect, useRef } from "react";

type Props = {
  url: string;
  title?: string;
  onClose: () => void;
};

export default function FullscreenFilmPlayer({ url, title, onClose }: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const shell = shellRef.current;
    const video = videoRef.current;
    if (!shell || !video) return;

    let wasFullscreen = false;

    const enter = async () => {
      try {
        if (shell.requestFullscreen) {
          await shell.requestFullscreen();
          wasFullscreen = true;
        } else {
          const v = video as HTMLVideoElement & {
            webkitEnterFullscreen?: () => void;
          };
          if (v.webkitEnterFullscreen) {
            v.webkitEnterFullscreen();
            wasFullscreen = true;
          }
        }
      } catch {
        /* play inline in overlay */
      }
      try {
        await video.play();
      } catch {
        /* autoplay blocked */
      }
    };

    void enter();

    const onFullscreenChange = () => {
      const active =
        document.fullscreenElement === shell ||
        (document as Document & { webkitFullscreenElement?: Element })
          .webkitFullscreenElement === shell;
      if (active) wasFullscreen = true;
      else if (wasFullscreen) onClose();
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
      if (document.fullscreenElement === shell) {
        void document.exitFullscreen().catch(() => {});
      }
    };
  }, [onClose, url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      ref={shellRef}
      className="film-fullscreen"
      role="dialog"
      aria-modal="true"
      aria-label={title ? `Playing ${title}` : "Final movie"}
    >
      <button
        type="button"
        className="film-fullscreen-close"
        onClick={onClose}
        aria-label="Close"
      >
        ✕
      </button>
      {title ? <p className="film-fullscreen-title">{title}</p> : null}
      <video
        ref={videoRef}
        className="film-fullscreen-video"
        src={url}
        controls
        playsInline
        autoPlay
      />
      <p className="film-fullscreen-hint">Esc to exit · Space to play/pause</p>
    </div>
  );
}