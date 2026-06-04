import { useMemo, useState } from "react";
import {
  assetCaption,
  assetFileUrl,
  listStillAssets,
  sceneTitleForAsset,
} from "./sceneAssets";
import type { Asset, Project } from "./types";

type Scope = "scene" | "project";

type Props = {
  project: Project;
  sceneId: string;
  assets: Asset[];
  activeKeyframeId?: string;
  disabled?: boolean;
  onSelect: (asset: Asset) => void;
};

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function ImageGallery({
  project,
  sceneId,
  assets,
  activeKeyframeId,
  disabled,
  onSelect,
}: Props) {
  const [scope, setScope] = useState<Scope>("scene");

  const sceneImages = useMemo(() => listStillAssets(assets, sceneId), [assets, sceneId]);
  const projectImages = useMemo(() => listStillAssets(assets), [assets]);
  const [expanded, setExpanded] = useState(() => sceneImages.length > 0);
  const shown = scope === "scene" ? sceneImages : projectImages;

  if (!projectImages.length) return null;

  return (
    <section className={`image-gallery${expanded ? " is-expanded" : ""}`}>
      <button
        type="button"
        className="image-gallery-toggle"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <span className="image-gallery-toggle-title">Image library</span>
        <span className="hint">
          {sceneImages.length} this scene · {projectImages.length} total
        </span>
        <span>{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div className="image-gallery-body">
          <p className="hint">
            Every generated or uploaded still is kept. Click any image to use it as this
            scene&apos;s keyframe.
          </p>

          <div className="image-gallery-scope">
            <button
              type="button"
              className={`settings-scope-btn${scope === "scene" ? " active" : ""}`}
              onClick={() => setScope("scene")}
            >
              This scene ({sceneImages.length})
            </button>
            <button
              type="button"
              className={`settings-scope-btn${scope === "project" ? " active" : ""}`}
              onClick={() => setScope("project")}
            >
              All clips ({projectImages.length})
            </button>
          </div>

          {shown.length === 0 ? (
            <p className="hint">No images yet for this view.</p>
          ) : (
            <ul className="image-gallery-grid">
              {shown.map((asset) => {
                const url = assetFileUrl(asset.id, assets);
                const isActive = asset.id === activeKeyframeId;
                const fromOtherScene =
                  asset.sceneId && asset.sceneId !== sceneId;
                return (
                  <li key={asset.id}>
                    <button
                      type="button"
                      className={`image-gallery-item${isActive ? " active" : ""}`}
                      disabled={disabled}
                      onClick={() => onSelect(asset)}
                      title={asset.prompt || assetCaption(asset, project)}
                    >
                      {url ? (
                        <img src={url} alt="" loading="lazy" />
                      ) : (
                        <span className="image-gallery-missing">Missing file</span>
                      )}
                      {isActive && <span className="image-gallery-badge">Keyframe</span>}
                      {fromOtherScene && (
                        <span className="image-gallery-badge image-gallery-badge-alt">
                          {sceneTitleForAsset(asset, project) ?? "Other"}
                        </span>
                      )}
                      <span className="image-gallery-meta">
                        <span className="image-gallery-meta-title">
                          {asset.label || assetKindShort(asset)}
                        </span>
                        <span className="hint">{formatWhen(asset.createdAt)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function assetKindShort(asset: Asset): string {
  if (asset.source === "upload") return "Upload";
  if (asset.type === "frame") return "Frame";
  return "Still";
}