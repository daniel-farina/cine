import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";

const STORAGE_WIDTH = "cine-inspector-width";
const STORAGE_COLLAPSED = "cine-inspector-collapsed";

export const INSPECTOR_MIN_WIDTH = 280;
export const INSPECTOR_MAX_WIDTH = 720;
export const INSPECTOR_DEFAULT_WIDTH = 400;
const RAIL_WIDTH = 44;

function readWidth(): number {
  const n = Number(localStorage.getItem(STORAGE_WIDTH));
  if (!Number.isFinite(n)) return INSPECTOR_DEFAULT_WIDTH;
  return Math.min(INSPECTOR_MAX_WIDTH, Math.max(INSPECTOR_MIN_WIDTH, n));
}

export function useInspectorLayout() {
  const [width, setWidth] = useState(readWidth);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(STORAGE_COLLAPSED) === "1"
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_WIDTH, String(width));
  }, [width]);

  useEffect(() => {
    localStorage.setItem(STORAGE_COLLAPSED, collapsed ? "1" : "0");
  }, [collapsed]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => !c);
  }, []);

  const onResizeStart = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = width;

      const onMove = (ev: globalThis.MouseEvent) => {
        const next = startW + (startX - ev.clientX);
        setWidth(
          Math.min(INSPECTOR_MAX_WIDTH, Math.max(INSPECTOR_MIN_WIDTH, next))
        );
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.classList.remove("workspace-resizing");
      };

      document.body.classList.add("workspace-resizing");
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [width]
  );

  const gridTemplateColumns = collapsed
    ? `minmax(0, 1fr) ${RAIL_WIDTH}px`
    : `minmax(0, 1fr) 6px ${width}px`;

  return {
    width,
    collapsed,
    setCollapsed,
    toggleCollapsed,
    onResizeStart,
    gridTemplateColumns,
    railWidth: RAIL_WIDTH,
  };
}