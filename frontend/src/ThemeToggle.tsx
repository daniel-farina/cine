import { useEffect, useState } from "react";
import { getTheme, subscribeTheme, toggleTheme, type Theme } from "./theme";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => getTheme());

  useEffect(() => subscribeTheme(() => setTheme(getTheme())), []);

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      className="btn btn-theme"
      onClick={() => toggleTheme()}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
    >
      <span className="btn-theme-icon" aria-hidden>
        {isDark ? "☀" : "☾"}
      </span>
      <span className="btn-theme-label">{isDark ? "Light" : "Dark"}</span>
    </button>
  );
}