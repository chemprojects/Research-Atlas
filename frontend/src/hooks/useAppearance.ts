import { useEffect, useState } from "react";

export type FontSize = "small" | "medium" | "large" | "xlarge";
export type Theme = "light" | "dark" | "darker" | "midnight";

const FONT_SCALES: Record<FontSize, number> = {
  small: 0.9,
  medium: 1,
  large: 1.12,
  xlarge: 1.25,
};

const FONT_STORAGE_KEY = "appearance_font_size";
const THEME_STORAGE_KEY = "appearance_theme";

const VALID_THEMES: Theme[] = ["light", "dark", "darker", "midnight"];

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  if (theme === "light") {
    document.documentElement.classList.remove("dark");
  } else {
    document.documentElement.classList.add("dark");
  }
}

export function useAppearance() {
  const [fontSize, setFontSizeState] = useState<FontSize>(() => {
    const stored = localStorage.getItem(FONT_STORAGE_KEY);
    if (stored && stored in FONT_SCALES) return stored as FontSize;
    return "medium";
  });

  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
    if (stored && VALID_THEMES.includes(stored)) return stored;
    return "dark";
  });

  const setFontSize = (size: FontSize) => {
    setFontSizeState(size);
    localStorage.setItem(FONT_STORAGE_KEY, size);
  };

  const setTheme = (next: Theme) => {
    setThemeState(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
    applyTheme(next);
  };

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--font-scale",
      String(FONT_SCALES[fontSize]),
    );
  }, [fontSize]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return { fontSize, setFontSize, fontScale: FONT_SCALES[fontSize], theme, setTheme };
}

/** Apply saved appearance on app boot (call once before render). */
export function initAppearance() {
  const storedFont = localStorage.getItem(FONT_STORAGE_KEY) as FontSize | null;
  const scale = storedFont && storedFont in FONT_SCALES ? FONT_SCALES[storedFont] : 1;
  document.documentElement.style.setProperty("--font-scale", String(scale));

  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
  const theme = storedTheme && VALID_THEMES.includes(storedTheme) ? storedTheme : "dark";
  applyTheme(theme);
}

export const THEME_OPTIONS: { id: Theme; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "darker", label: "Darker" },
  { id: "midnight", label: "Midnight" },
];
