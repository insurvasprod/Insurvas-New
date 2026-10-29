"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { titleCaseNode } from "@/components/ui/title-case"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        // 14px (the type scale’s caption step; the board’s 13px is off-scale), and the outer columns keep a 16px gutter so the first and last cell line up with
        // the card's own header and footer rather than with the middle columns' 10px.
        className={cn(
          "w-full caption-bottom text-sm [&_tr>*:first-child]:pl-4 [&_tr>*:last-child]:pr-4",
          className
        )}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      // A filled header row, not a rule. On a 30-row table the rule disappears the moment the
      // reader scrolls; the ground is still there, and it is what says "these are the names of the
      // columns" rather than "this is the first row".
      className={cn("bg-[var(--surface-alt)] [&_tr]:border-0", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      // m-seq fills the rows in top-down after the page lands. Opacity only, so a 40-row table
      // does not ripple, and the eighth row onwards lands together.
      className={cn("m-seq [&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        // m-row carries the hover tint: the action colour at 5%, not grey. Grey reads as "disabled"
        // on a row you are about to act on. Selected and expanded keep the solid ground.
        // The rule between rows is the soft grey, not the card's own border: a table of 30 rows
        // drawn in --border reads as a grid of boxes rather than a list.
        "m-row border-b border-[var(--surface-alt)] has-aria-expanded:bg-muted data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, children, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      // Foundation v3 (2026-10-27): a 40px head in sentence case at the label step, 13/500.
      className={cn(
        "h-10 px-2.5 text-left align-middle text-label whitespace-nowrap text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    >
      {titleCaseNode(children)}
    </th>
  )
}

/**
 * 44px rows (owner pick, 2026-10-27): v3 draws 52px, which fits too few rows on a queue; the old
 * 38px was too tight beside the 40px head. The note below is why it is not taller.
 *
 * 8px vertical padding, not 12.
 *
 * The roomier cell measured 46.7px a row against 38.7px, which is three fewer rows in a 900px
 * viewport — a 19% loss on screens an agent reads all day. Marketing spacing belongs on marketing
 * pages; a queue is paid for in rows.
 */
function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "h-11 px-2.5 py-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
