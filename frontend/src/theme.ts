export type Theme = "dark" | "light";

const STORAGE_KEY = "cine-theme";

const listeners = new Set<() => void>();

export function getTheme(): Theme {
  const t = document.documentElement.dataset.theme;
  return t === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem(STORAGE_KEY, theme);
  listeners.forEach((fn) => fn());
}

export function toggleTheme(): Theme {
  const next = getTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}

export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function initTheme(): void {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") {
    applyTheme(stored);
    return;
  }
  applyTheme("dark");
}