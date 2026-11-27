import type { TodoItem } from "./types";

/**
 * Board B6 · the bookkeeper's Home, the parts the shared home logic does not hold: "Cash this month" (the month's
 * deposits by week, from GET /api/app/accounting/bank?deposits=) and the "Waiting on you" rows, which also list what
 * waits on someone else.
 */

/** GET /api/app/accounting/bank?deposits=YYYY-MM&today=YYYY-MM-DD (lib/accounting/depositWeeksCore.ts DepositWeeks). */
export type DepositWeek = { from: string; to: string; cents: number };
export type DepositsAnswer = { deposits: { month: string; from: string; through: string; totalCents: number; count: number; weeks: DepositWeek[] } };

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 3" (the board's axis), from "2026-11-03". */
export function axisDay(iso: string): string {
  return `${SHORT[Number(iso.slice(5, 7)) - 1] ?? ""} ${Number(iso.slice(8, 10))}`.trim();
}

/**
 * The bars' labels as the board draws six: the first, every other one, and always the last ("Nov 3", "", "Nov 10",
 * "", "Nov 17", "Nov 20").
 */
export function barLabels(weeks: readonly DepositWeek[]): string[] {
  const n = weeks.length;
  return weeks.map((w, i) => (i % 2 === 0 || i === n - 1 ? axisDay(w.from) : ""));
}

/** The route that answers "Cash this month" for the phone's month and day. */
export const depositsPath = (today: string) => `/api/app/accounting/bank?deposits=${today.slice(0, 7)}&today=${today}`;

export type WaitingRow = { item: TodoItem; meta: string; waitsOnOthers: boolean };

/**
 * "Waiting on you": what waits on this person first, then what waits on someone else (a disputed bill waits on the
 * vendor), oldest first within each as the server sends them. The server's own detail is the line under each; a row
 * waiting on someone else says who it waits on, in the server's words.
 */
export function waitingRows(items: readonly TodoItem[], max = 5): WaitingRow[] {
  const mine = items.filter((i) => i.yours).map((item) => ({ item, meta: item.detail, waitsOnOthers: false }));
  const others = items.filter((i) => !i.yours).map((item) => ({ item, meta: othersMeta(item), waitsOnOthers: true }));
  return [...mine, ...others].slice(0, max);
}

function othersMeta(item: TodoItem): string {
  // The only rows the To do marks as not yours are bills in dispute (lib/accounting/todoCore.ts): the vendor answers next.
  const who = item.group === "bills" ? "Waiting on the vendor" : "Waiting on someone else";
  return item.detail ? `${who} · ${item.detail}` : who;
}
