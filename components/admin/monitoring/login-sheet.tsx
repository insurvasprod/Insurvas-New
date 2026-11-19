"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { FactTable } from "@/components/ui/fact-table";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { loginFailureLabel, type LoginEventRow } from "@/lib/loginEvents/constants";
import { deviceLabel, loginEventTime, loginOutcomeLabel, summariseUserAgent } from "@/lib/loginEvents/present";

type Detail = { event: LoginEventRow; sameIp: LoginEventRow[]; sameAccount: LoginEventRow[]; tenantName: string | null };

const ROW = "flex min-w-0 items-center gap-3 border-b border-border py-2 text-sm last:border-b-0";
const pad = (value: number) => String(value).padStart(2, "0");
const clock = (iso: string) => {
  const date = new Date(iso);
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
};

function Related({ title, rows, show, empty }: { title: string; rows: LoginEventRow[]; show: "email" | "ip"; empty: string }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="m-0 text-sm font-semibold text-foreground">{title}</h3>
      {rows.length === 0 ? (
        <p className="m-0 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="m-0 list-none p-0" aria-label={title}>
          {rows.map((row) => (
            <li key={row.id} className={ROW}>
              <span className="w-12 shrink-0 tabular-nums text-muted-foreground" title={loginEventTime(row.ts)}>{clock(row.ts)}</span>
              <span className="min-w-0 flex-1 truncate text-foreground" title={show === "email" ? row.email : row.ip ?? undefined}>
                {show === "email" ? row.email : row.ip ?? "No address recorded"}
              </span>
              <StatusChip tone={row.success ? "good" : "danger"} dot>{row.success ? "Signed in" : "Failed"}</StatusChip>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One sign-in attempt as a right sheet (admin round 1, monitoring.html screen 2): what happened, from where and on
 * what device; everything else from the same address and on the same account in the 24 hours before it; the full
 * user agent; a link to the person (the customer's user page, or Admin users for staff — super admin only) and, for
 * a super admin, to Lockouts. Read from GET /api/admin/activity/[id], which applies the staff rule.
 */
export function LoginSheet({ id, row, viewerRole, onClose }: { id: string; row: LoginEventRow | null; viewerRole: string; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "failed">("loading");
  const [retry, setRetry] = useState(0);
  const superAdmin = viewerRole === "super_admin";

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/activity/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 404) return setState("missing");
        if (!response.ok) return setState("failed");
        setDetail((await response.json()) as Detail);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [id, retry]);

  const event = detail?.event ?? row;
  const title = event ? (event.success ? "Signed in" : loginFailureLabel(event.failure_reason)) : "Sign-in attempt";
  const userHref = event
    ? event.actor_type === "user" && event.user_id
      ? `/admin/users/${event.user_id}`
      : event.actor_type === "admin" && superAdmin
        ? "/admin/admins"
        : null
    : null;

  return (
    <Sheet
      title={title}
      subtitle={event ? `${event.email} · ${loginEventTime(event.ts)}` : undefined}
      status={event ? <StatusChip tone={event.success ? "good" : "danger"} dot>{loginOutcomeLabel(event)}</StatusChip> : undefined}
      onClose={onClose}
      bodyClassName="flex flex-col gap-4 px-4 pb-4"
      footer={
        <>
          {userHref && (
            <Link href={userHref} className={buttonVariants({ variant: "outline" })}>
              {event?.actor_type === "admin" ? "Open Admin users" : "Open the user"}
            </Link>
          )}
          {superAdmin && (
            <Link href="/admin/monitoring/lockouts" className={buttonVariants({ variant: "ghost" })}>
              See lockouts
            </Link>
          )}
          <span className="flex-1" />
          <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
        </>
      }
    >
      {event && (
        <FactTable
          rows={[
            ["IP", event.ip ? <code className="font-mono text-xs">{event.ip}</code> : "None recorded"],
            ["Device", deviceLabel(event.user_agent) ?? "Unknown"],
            ["Browser", summariseUserAgent(event.user_agent)],
            ["Who", event.actor_type === "admin" ? "Staff member" : "Customer user"],
            ["Workspace", detail?.tenantName ?? null],
            ["Why it failed", event.success ? null : loginFailureLabel(event.failure_reason)],
          ]}
        />
      )}

      {state === "loading" && <SectionLoading rows={4} columns={3} label="Loading what else came from this address" />}
      {state === "failed" && (
        <ErrorState
          title="The related attempts did not load"
          detail="Nothing is shown rather than an empty list. Try again."
          action={<Button type="button" variant="outline" onClick={() => { setState("loading"); setRetry((n) => n + 1); }}>Try again</Button>}
        />
      )}
      {state === "missing" && <EmptyState title="This attempt isn't available" hint="It may be a staff sign-in your role can't see, or the link is wrong." />}
      {state === "ready" && detail && (
        <>
          <Related
            title="Same address, last 24 hours"
            rows={detail.sameIp}
            show="email"
            empty={detail.event.ip ? "Nothing else came from this address." : "No address was recorded for this attempt."}
          />
          <Related title="Same account, last 24 hours" rows={detail.sameAccount} show="ip" empty="No other attempt on this account." />
          <section className="flex flex-col gap-1">
            <h3 className="m-0 text-sm font-semibold text-foreground">Full user agent</h3>
            <p className="m-0 break-all rounded-md border border-border bg-[var(--surface-alt)] px-3 py-2 font-mono text-xs text-[var(--body)]">
              {detail.event.user_agent ?? "None recorded"}
            </p>
          </section>
        </>
      )}
    </Sheet>
  );
}
