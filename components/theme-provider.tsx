"use client";

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  setTheme: () => undefined,
});

const THEME_STORAGE_KEY = "theme";
const THEME_CHANGE_EVENT = "insurvas-theme-change";

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function subscribeToTheme(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(THEME_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(THEME_CHANGE_EVENT, callback);
  };
}

function getServerTheme(): Theme {
  return "system";
}

/**
 * Mounts the theme without rendering an inline script from a client component.
 *
 * next-themes injects a bootstrap <script> into its client component. Next.js 16 reports that
 * script as a client-rendering error in development, and the script also makes the first client
 * tree differ from the server tree. useSyncExternalStore gives SSR a stable "system" snapshot;
 * the browser reads the user's saved choice after hydration and applies the html class in one
 * effect. This keeps the provider deterministic without a hydration overlay.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribeToTheme, getStoredTheme, getServerTheme);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const isDark = theme === "dark" || (theme === "system" && media.matches);
      const root = document.documentElement;
      // The class lands after first paint (see above), and every control carries a 120ms colour
      // transition — so without this, a dark-mode load visibly fades each button, link and field
      // from light to dark. Transitions are switched off for the one frame the class changes in.
      root.classList.add("theme-switching");
      root.classList.toggle("dark", isDark);
      root.style.colorScheme = isDark ? "dark" : "light";
      void root.offsetHeight; // commit the new colours before transitions come back
      requestAnimationFrame(() => root.classList.remove("theme-switching"));
    };

    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    setTheme: (nextTheme) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
    },
  }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
