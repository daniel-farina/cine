import { useCallback, useRef, useState, forwardRef, useImperativeHandle } from "react";

const ACCEPT = "image/png,image/jpeg,image/jpg,image/webp,image/gif";

export type ImageUploadZoneHandle = {
  openFilePicker: () => void;
};

type Props = {
  disabled?: boolean;
  busy?: boolean;
  hasKeyframe?: boolean;
  highlight?: boolean;
  compact?: boolean;
  onFile: (file: File) => void | Promise<void>;
};

const ImageUploadZone = forwardRef<ImageUploadZoneHandle, Props>(function ImageUploadZone(
  { disabled, busy, hasKeyframe, highlight, compact, onFile },
  ref
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);

  useImperativeHandle(ref, () => ({
    openFilePicker: () => inputRef.current?.click(),
  }));

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file || disabled || busy) return;
      if (!file.type.startsWith("image/")) return;
      await onFile(file);
    },
    [busy, disabled, onFile]
  );

  const openPicker = () => {
    if (!disabled && !busy) inputRef.current?.click();
  };

  return (
    <div
      ref={rootRef}
      className={`image-upload${compact ? " image-upload-compact" : ""}${dragOver ? " drag-over" : ""}${highlight ? " selected-method" : ""}${disabled ? " disabled" : ""}`}
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled && !busy) setDragOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled && !busy) setDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        void handleFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="image-upload-input"
        disabled={disabled || busy}
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="image-upload-inner">
        <span className="image-upload-icon" aria-hidden>
          ↑
        </span>
        <div>
          <p className="image-upload-title">
            {hasKeyframe ? "Replace with your image" : "Upload from computer"}
          </p>
          <p className="hint image-upload-hint">
            Drag and drop here, or{" "}
            <button
              type="button"
              className="image-upload-link"
              disabled={disabled || busy}
              onClick={openPicker}
            >
              browse files
            </button>
          </p>
          {!compact && (
            <p className="hint image-upload-formats">PNG, JPEG, WebP, GIF · max 25MB</p>
          )}
        </div>
      </div>
    </div>
  );
});

export default ImageUploadZone;