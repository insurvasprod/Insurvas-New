"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";
import { titleCaseNode } from "./title-case";

/**
 * A table row's next step, drawn as a button (owner 2026-11-19: "whenever you see a next step column, it should be a
 * button, not a link"). One look in every table: a small outline button with a chevron, in the row's last column,
 * right-aligned. The label is the step itself ("Review", "Decide", "Add Rate"), never "Click here".
 *
 * `href` makes it a link (soft navigation); `onClick` a button that opens a panel or dialog. It never lets its click
 * fall through to a clickable row, so the row's own click and the button never fire twice.
 */
type Common = { children: React.ReactNode; className?: string; title?: string; disabled?: boolean; "aria-label"?: string };

/** The row action's look, for the rare trigger that must be its own element (a menu's `asChild` trigger). */
export const rowActionClass = (className?: string) => cn(buttonVariants({ variant: "outline", size: "xs" }), "h-7 gap-1 whitespace-nowrap px-2.5 text-xs font-semibold", className);

/** The row action's inside: its label in Title Case, then the chevron. */
export function RowActionLabel({ children }: { children: React.ReactNode }) {
  return (
    <>
      <span>{titleCaseNode(children)}</span>
      <ChevronRight aria-hidden="true" className="size-3.5 opacity-70" />
    </>
  );
}

export function RowAction(props: Common & ({ href: string; onClick?: never; prefetch?: boolean } | { href?: never; onClick: (event: React.MouseEvent<HTMLButtonElement>) => void })) {
  const { children, className, title, disabled } = props;
  const look = rowActionClass(className);
  const content = <RowActionLabel>{children}</RowActionLabel>;
  const stop = (event: React.MouseEvent) => event.stopPropagation();
  if ("href" in props && props.href !== undefined) {
    if (disabled) return <span data-slot="row-action" aria-disabled="true" title={title} className={cn(look, "pointer-events-none opacity-50")}>{content}</span>;
    return <Link data-slot="row-action" href={props.href} prefetch={props.prefetch} title={title} aria-label={props["aria-label"]} onClick={stop} className={look}>{content}</Link>;
  }
  return (
    <button data-slot="row-action" type="button" title={title} aria-label={props["aria-label"]} disabled={disabled} className={look} onClick={(event) => { stop(event); props.onClick?.(event); }}>
      {content}
    </button>
  );
}

/** The cell the button sits in: the table's last column, right-aligned, never wrapping. */
export function RowActionCell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td data-slot="row-action-cell" className={cn("w-px whitespace-nowrap text-right", className)}>{children}</td>;
}
