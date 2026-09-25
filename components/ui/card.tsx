import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A white module on the page grey.
 *
 * The hairline shadow is not decoration: with the old ramp a card sat 1.03:1 above its page and was
 * invisible, so the border did all the work and every screen read as one flat sheet. The ramp now
 * separates them, and this adds the last edge of lift.
 *
 * `interactive` is for a tile that is itself a link or a button. It gets the real shadow on hover
 * plus a 1px rise, so the thing you can press is the thing that moves.
 */
function Card({
  className,
  interactive = false,
  ...props
}: React.ComponentProps<"div"> & { interactive?: boolean }) {
  return (
    <div
      data-slot="card"
      data-interactive={interactive || undefined}
      className={cn(
        "flex flex-col gap-6 rounded-lg border bg-card py-6 text-card-foreground",
        "shadow-[0_1px_2px_rgba(16,20,26,.05)] dark:shadow-[0_1px_2px_rgba(0,0,0,.55)]",
        interactive &&
          "cursor-pointer transition-[box-shadow,transform,border-color] duration-150 hover:-translate-y-px hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-hover)] motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("text-lg leading-[1.28] font-semibold tracking-[-0.015em]", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-6", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-6 [.border-t]:pt-6", className)}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
