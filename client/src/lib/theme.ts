import { useEffect, useState } from "react";

export type ThemeName = "day" | "night";

const KEY = "grokbot:theme";

export function readTheme(): ThemeName {
  try {
    return localStorage.getItem(KEY) === "day" ? "day" : "night";
  } catch {
    return "night";
  }
}

export function applyTheme(theme: ThemeName) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* 隐私模式等写不进去时，本次会话仍然生效 */
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeName>(readTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return { theme, setTheme: setThemeState };
}
