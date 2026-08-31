"use client";

import { useTheme } from "@/components/theme-provider";
import { Sun, Moon, Monitor } from "lucide-react";

/**
 * Light / dark / follow-the-system, as three explicit choices rather than a two-state switch.
 *
 * A toggle that only flips between light and dark has no way back to "whatever my machine is
 * doing", and someone who lands on the wrong one at 9am is stuck with it. Three states costs one
 * extra button and removes that trap.
 *
 * The provider uses a stable server snapshot, so this control can render the same three choices on
 * the server and the first client pass without a placeholder or hydration mismatch.
 */
const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

export function ThemeToggle({ tone = "default" }: { tone?: "default" | "onBrand" }) {
  const { theme, setTheme } = useTheme();

  // The agent and admin shells put this on a navy sidebar, where the normal border and muted
  // foreground tokens are invisible.
  const shell =
    tone === "onBrand"
      ? "border-white/15 bg-white/5"
      : "border-border bg-card";

  const idle =
    tone === "onBrand"
      ? "text-white/60 hover:text-white hover:bg-white/10"
      : "text-muted-foreground hover:text-foreground hover:bg-muted";

  const active =
    tone === "onBrand"
      ? "bg-white/20 text-white"
      : "bg-muted text-foreground";

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={`flex items-center gap-0.5 rounded-md border p-0.5 ${shell}`}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const selected = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={`flex flex-1 items-center justify-center rounded px-2 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-blue)] ${
              selected ? active : idle
            }`}
          >
            <Icon className="size-3.5" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
