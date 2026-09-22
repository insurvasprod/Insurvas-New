import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The secondary action of this system.
 *
 * Links here are ink rather than blue, so there is no hue to say "this goes somewhere" — the arrow
 * does it, and the arrow sliding on hover says it is live. Use it inside cards and feature sections
 * for exploration; use a secondary Button when the action is a commitment rather than a read.
 *
 * The arrow is decorative: the label carries the meaning, and it names the destination
 * ("Read the integration guide"), never the gesture ("Learn more").
 */
function LinkArrow({
  className,
  children,
  ...props
}: React.ComponentProps<"a">) {
  return (
    <a
      data-slot="link-arrow"
      className={cn(
        "group inline-flex items-center gap-2 text-sm font-semibold tracking-[-0.01em] text-foreground no-underline",
        "rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background",
        className
      )}
      {...props}
    >
      {children}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="size-4 shrink-0 transition-transform duration-150 group-hover:translate-x-1 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
      >
        <path d="M5 12h14m0 0-6-6m6 6-6 6" />
      </svg>
    </a>
  )
}

export { LinkArrow }
