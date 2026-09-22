"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The global search affordance: a utility control, not a call to action.
 *
 * Deliberately quiet — muted band, muted text, no fill and no pill — so it never competes with the
 * page's primary action. The keycap hint is decorative; the control still needs its own accessible
 * name, which the label provides.
 */
function SearchCommand({
  label = "Search",
  placeholder = "Search…",
  shortcut = ["⌘", "K"],
  className,
  ...props
}: Omit<React.ComponentProps<"button">, "children"> & {
  label?: string
  placeholder?: string
  shortcut?: string[] | null
}) {
  return (
    <button
      type="button"
      data-slot="search-command"
      aria-label={label}
      className={cn(
        "inline-flex w-full max-w-md items-center gap-2 rounded-md border border-border bg-muted px-3 py-2",
        "text-sm text-muted-foreground transition-colors hover:text-foreground",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className
      )}
      {...props}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="size-4 shrink-0"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <span className="flex-1 truncate text-left">{placeholder}</span>
      {shortcut?.length ? (
        <span className="hidden gap-1 sm:flex" aria-hidden="true">
          {shortcut.map((key) => (
            <kbd
              key={key}
              className="rounded-sm border border-border bg-card px-1.5 font-mono text-xs text-muted-foreground"
            >
              {key}
            </kbd>
          ))}
        </span>
      ) : null}
    </button>
  )
}

export { SearchCommand }
