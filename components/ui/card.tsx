import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The one card (foundation v3, 2026-10-27): the shared glass surface, 12px corners, 16px padding and
 * a 15/600 title. Settings cards, record cards and every local `CARD`/`GLASS` constant are this.
 *
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
        // m-glass: the frosted card surface and its hairline lift (app/globals.css, glass layer). A
        // caller's own bg-* class still wins, since utilities sit above the components layer.
        "m-glass flex flex-col gap-4 rounded-lg border py-4 text-card-foreground",
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
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1 px-4 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-4",
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
      className={cn("text-card-title text-[var(--ink)]", className)}
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
      className={cn("px-4", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-4 [.border-t]:pt-4", className)}
      {...props}
    />
  )
}

/**
 * The card's surface as classes, for a section that lays out its own inside (a settings board, a
 * day plan). The same glass as <Card>; never a local GLASS or CARD constant (the `local-surface`
 * ratchet).
 *   cardSurface  the card: glass, 12px corners, the hairline border.
 *   cardHead     a header or footer band inside it, see-through.
 *   cardInset    a tile or row inside a card: a lighter glass with its own border.
 *   glass        the glass fill alone, for a box that sets its own corners and border.
 */
const cardSurface = "m-glass rounded-lg border border-border"
const cardHead = "m-glass-head"
const cardInset = "m-glass-inset rounded-lg border border-[var(--border)]"
const glass = "m-glass"

export {
  cardHead,
  cardInset,
  cardSurface,
  glass,
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
