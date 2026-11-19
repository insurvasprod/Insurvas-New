import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { loadTodo } from "@/lib/accounting/todoStore";
import { isTodoGroup, TODO_GROUPS, todoCounts, type TodoGroup } from "@/lib/accounting/todoCore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { TodoBoard } from "@/components/app/accounting/todo-board";
import { buttonVariants } from "@/components/ui/button";
import { StreamSection } from "@/components/ui/stream-section";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Accounting › To do (round 7, owner 2026-11-10: docs/la4/mockups-r7/accounting.html 0·1). The first step of
 * Accounting: everything that waits on a person anywhere in it, oldest first. A row opens the page or dialog
 * where it is done; the groups (Bank · Bills · Expenses · Payouts · Tax) are the sub-page bar (`?group=`).
 * Owners and bookkeepers; each group only where this person may open the page its rows lead to.
 */
export default async function AccountingTodoPage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const [money, tax, payouts] = await Promise.all([guardPage("profit_and_loss"), guardPage("tax_summaries"), guardPage("payout_runs")]);
  if (!money.entitled) {
    return <FeatureGateNotice guard={money} featureLabel="Accounting" description="What the agency made, what it owes, and what waits on you." />;
  }
  if (!actAsPage(money, ["owner", "bookkeeper"])) {
    return <RoleGateNotice featureLabel="Accounting › To do" detail="Only owners and bookkeepers can see what waits in the agency's accounts." />;
  }
  const q = await searchParams;
  const group = isTodoGroup(q.group) ? q.group : null;
  const access = {
    bank: true, bills: true, expenses: true,
    payouts: payouts.entitled && actAsPage(payouts, ["owner", "bookkeeper"]),
    tax: tax.entitled && actAsPage(tax, ["owner", "bookkeeper"]),
  };
  const readOnly = money.entitlement.access === "read_only";
  // Frame first (UI-CONSISTENCY §7a): the list is read now; the title, the groups and the button draw at once, the
  // counts and the rows when it lands.
  const read: TodoRead = loadTodo(money.context.tenantId, access).then(({ items }) => items);
  const at = (g: string | null) => (g ? `/app/accounting?group=${g}` : "/app/accounting");
  const tabsOf = (counts: ReturnType<typeof todoCounts> | null) => (
    <ViewTabs label="To do" value={group ?? "all"} tabs={[
      { key: "all", label: "All", count: counts?.all ?? null, href: at(null) },
      ...TODO_GROUPS.filter((g) => access[g.key]).map((g) => ({ key: g.key, label: g.label, count: counts ? counts[g.key] || null : null, tone: g.key === "bank" || g.key === "tax" ? ("danger" as const) : undefined, href: at(g.key) })),
    ]} />
  );
  const paused = (title: string) => <span className={buttonVariants({ className: "pointer-events-auto cursor-not-allowed opacity-50" })} title={title} aria-disabled="true">Start with the oldest</span>;
  return (
    <AccountingPage
      step="todo"
      info="Everything in Accounting that waits for a person, oldest first. Nothing here is done for you: a row opens the page where it is done."
      tabs={<Suspense fallback={tabsOf(null)}><TodoTabs read={read} tabsOf={tabsOf} /></Suspense>}
      actions={<Suspense fallback={paused(readOnly ? "Paused while the account is read-only." : "Waiting for the list.")}><TodoStart read={read} group={group} readOnly={readOnly} paused={paused} /></Suspense>}
    >
      <StreamSection shape="table">
        <TodoRows read={read} group={group} />
      </StreamSection>
    </AccountingPage>
  );
}

type TodoRead = Promise<Awaited<ReturnType<typeof loadTodo>>["items"]>;
type Group = TodoGroup | null;

const shownOf = (items: Awaited<TodoRead>, group: Group) => (group ? items.filter((i) => i.group === group) : items);

async function TodoTabs({ read, tabsOf }: { read: TodoRead; tabsOf: (counts: ReturnType<typeof todoCounts> | null) => ReactNode }) {
  return tabsOf(todoCounts(await read));
}

async function TodoStart({ read, group, readOnly, paused }: { read: TodoRead; group: Group; readOnly: boolean; paused: (title: string) => ReactNode }) {
  const shown = shownOf(await read, group);
  const first = shown.find((i) => i.yours) ?? shown[0] ?? null;
  if (!first) return null;
  return readOnly ? paused("Paused while the account is read-only.") : <Link href={first.href} className={buttonVariants()}>Start With the Oldest</Link>;
}

async function TodoRows({ read, group }: { read: TodoRead; group: Group }) {
  const shown = shownOf(await read, group);
  return <TodoBoard items={shown} groupLabel={group ? TODO_GROUPS.find((g) => g.key === group)?.label ?? null : null} />;
}
