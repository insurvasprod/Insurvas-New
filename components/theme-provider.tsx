"use client";

import { ThemeProvider as NextThemeProvider } from "next-themes";

/**
 * Mounts the theme.
 *
 * `next-themes` has been a dependency since the start and nothing mounted it — `components/ui/sonner.tsx`
 * called `useTheme()` under no provider, which is why the toast component was the only thing in the
 * codebase with an opinion about dark mode and no way to act on it.
 *
 * `attribute="class"` puts `class="dark"` on <html>, including when the resolved value comes from
 * the OS rather than a stored choice. One class drives both, so the CSS and the toggle cannot
 * disagree — which is the usual failure when a media query and a class are wired independently.
 *
 * `disableTransitionOnChange` because repainting every surface over a transition reads as a
 * rendering fault. The swap should be instant.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemeProvider>
  );
}
