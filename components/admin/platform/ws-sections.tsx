import { cache } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { WsPanel } from "@/components/admin/billing/ws-panel";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import type { AdminRole } from "@/lib/adminAuth/roles";
import { canOpenAdminHref } from "@/lib/adminDashboard/compose";
import { needsTotal, platformNeeds, waitedWords, type PlatformNeedTone, type PlatformQueues } from "@/lib/adminPlatform/needs";
import { platformQueues } from "@/lib/adminPlatform/reads";
import { platformStepsFor } from "@/lib/adminPlatform/steps";

/**
 * Admin › Platform workspace parts (admin round 1, owner 2026-11-18): the figures and Needs a look, each streaming on
 * its own. Twins: components/admin/catalog/ws-sections.tsx, components/admin/monitoring/ws-sections.tsx.
 */

type Viewer = { id: string; role: AdminRole };

const n = (value: number) => value.toLocaleString("en-US");
const plural = (count: number, one: string, many = `${one}s`) => `${n(count)} ${count === 1 ? one : many}`;
const rowLink = "flex min-h-11 items-center gap-3 border-b border-border px-4 py-2 text-sm text-foreground no-underline last:border-b-0 hover:bg-[var(--hover-wash)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring-color)]";
const unread = "Couldn't be read";

/** The request's clock, read once beside the rows it dates. */
function readClock(): number {
  return Date.now();
}

/** One read of every queue per request: the figures and Needs a look share it. */
const queuesFor = cache((id: string, role: AdminRole) => platformQueues({ id, role }));

type FigureKey = "dialing" | "disclosures" | "calling" | "mail" | "maintenance" | "admins" | "legal" | "needs";

/** The figures a role gets: one per Platform page it may open that has one, then what needs a look. */
function figureKeys(role: AdminRole): FigureKey[] {
  const open = new Set<string>(platformStepsFor(role).map((step) => step.key));
  const keys: FigureKey[] = [];
  if (open.has("compliance")) keys.push("dialing");
  if (open.has("disclosures")) keys.push("disclosures");
  if (open.has("calling")) keys.push("calling");
  if (open.has("maintenance")) keys.push("maintenance");
  if (open.has("mail")) keys.push("mail");
  if (open.has("admins")) keys.push("admins");
  if (open.has("legal")) keys.push("legal");
  keys.push("needs");
  return keys;
}

const FIGURE_LABEL: Record<FigureKey, string> = {
  dialing: "Dialing screening",
  disclosures: "States covered",
  calling: "Calling rules reviewed",
  maintenance: "Maintenance",
  mail: "Email",
  admins: "Active admins",
  legal: "Legal drafts",
  needs: "Needs a look",
};

function Figure({ name, queues, now }: { name: FigureKey; queues: PlatformQueues; now: number }) {
  const label = FIGURE_LABEL[name];
  switch (name) {
    case "dialing": {
      const q = queues.compliance;
      if (!q) return <StatTile label={label} value="—" footnote={unread} href="/admin/compliance-sources" />;
      const value = q.demo ? "Demo" : q.blocked ? "Blocked" : "Open";
      return (
        <StatTile
          label={label}
          valueSize="text"
          value={value}
          valueTone={q.demo ? "info" : q.blocked ? "danger" : "good"}
          footnote={`${n(q.enabled)} of ${plural(q.registered, "vendor")} enabled${q.unreachable ? ` · ${n(q.unreachable)} unreachable` : ""}`}
          labelTitle="Whether the dial gate can screen calls right now: a DNC and a litigator vendor enabled and answering."
          href="/admin/compliance-sources"
        />
      );
    }
    case "disclosures": {
      const q = queues.disclosures;
      if (!q) return <StatTile label={label} value="—" footnote={unread} href="/admin/state-disclosures" />;
      return (
        <StatTile
          label={label}
          value={n(q.statesCovered)}
          valueTone={q.uncovered > 0 ? "warning" : undefined}
          footnote={q.uncovered > 0 ? `of 50 + DC · ${plural(q.uncovered, "pair")} uncovered` : "of 50 + DC"}
          labelTitle="A state counts when every product has wording in force there: what the dialer needs to place the call."
          href={q.uncovered > 0 ? "/admin/state-disclosures?show=not_covered" : "/admin/state-disclosures"}
        />
      );
    }
    case "calling": {
      const q = queues.calling;
      if (!q) return <StatTile label={label} value="—" footnote={unread} href="/admin/calling-rules" />;
      const when = waitedWords(q.reviewedAt, now);
      return (
        <StatTile
          label={label}
          valueSize="text"
          value={!q.reviewedAt ? "Never" : when === "today" ? "Today" : `${when} ago`}
          valueTone={q.stale ? "danger" : undefined}
          footnote={q.stale ? "stale: every dial is refused" : q.staleAfterDays === null ? "not recorded" : `stale after ${plural(q.staleAfterDays, "day")}`}
          href="/admin/calling-rules"
        />
      );
    }
    case "maintenance": {
      const q = queues.maintenance;
      if (!q) return <StatTile label={label} value="—" footnote={unread} href="/admin/system" />;
      return (
        <StatTile
          label={label}
          valueSize="text"
          value={q.on ?? "Off"}
          valueTone={q.on ? "danger" : undefined}
          footnote={q.scheduled ? `${q.scheduled} scheduled` : q.announcementsLive === null ? "announcements couldn't be read" : `${plural(q.announcementsLive, "announcement")} live`}
          href="/admin/system"
        />
      );
    }
    case "mail": {
      const q = queues.mail;
      if (!q) return <StatTile label={label} value="—" footnote={unread} href="/admin/email" />;
      const sending = q.smtp && q.missing.length === 0;
      return (
        <StatTile
          label={label}
          valueSize="text"
          value={sending ? "Sending" : "Not sent"}
          valueTone={sending ? "good" : "warning"}
          footnote={!q.smtp ? "delivery is off here" : q.missing.length ? `${plural(q.missing.length, "setting")} missing` : "through SMTP, every attempt logged"}
          href="/admin/email"
        />
      );
    }
    case "admins": {
      const q = queues.admins;
      if (!q) return <StatTile label={label} value="—" footnote={unread} href="/admin/admins" />;
      return (
        <StatTile
          label={label}
          value={n(q.active)}
          footnote={q.noTwoFactor ? `${n(q.noTwoFactor)} without two-factor` : `${plural(q.activeSuperAdmins, "super admin")}`}
          href="/admin/admins"
        />
      );
    }
    case "legal": {
      const q = queues.legal;
      if (!q) return <StatTile label={label} value="—" footnote={unread} href="/admin/legal" />;
      return (
        <StatTile
          label={label}
          value={n(q.drafts)}
          valueTone={q.drafts ? "warning" : undefined}
          footnote={!q.supported ? "drafts need a database update" : q.drafts ? "saved, not published" : "nothing unpublished"}
          href={q.docs[0] ? `/admin/legal?doc=${q.docs[0]}` : "/admin/legal"}
        />
      );
    }
    case "needs": {
      const total = needsTotal(queues, now);
      return (
        <StatTile
          label={label}
          value={total === null ? "—" : n(total)}
          valueTone={total ? "highlight" : undefined}
          footnote={total === null ? "nothing could be read" : total > 0 ? "listed below" : "all clear"}
        />
      );
    }
  }
}

/** One figure per Platform page the role may open, then how many things need a look. */
export async function PlatformWsFigures({ viewer }: { viewer: Viewer }) {
  const queues = await queuesFor(viewer.id, viewer.role);
  const now = readClock();
  return (
    <StatStrip label="Platform figures">
      {figureKeys(viewer.role).map((key) => <Figure key={key} name={key} queues={queues} now={now} />)}
    </StatStrip>
  );
}

/** A figure still on its way: a skeleton the size of a number. */
function FigureSkeleton() {
  return <span aria-hidden="true" className="m-skel inline-block h-6 w-16 rounded-md" />;
}

export function PlatformWsFiguresLoading({ role }: { role: AdminRole }) {
  return (
    <StatStrip label="Platform figures">
      {figureKeys(role).map((key) => <StatTile key={key} label={FIGURE_LABEL[key]} value={<FigureSkeleton />} reserveFootnote />)}
    </StatStrip>
  );
}

/* ── Needs a look ────────────────────────────────────────────────────────────────────────────── */

const NEED_CHIP: Record<PlatformNeedTone, { tone: StatusTone; label: string }> = {
  act: { tone: "danger", label: "Act now" },
  review: { tone: "warning", label: "Review" },
  unknown: { tone: "neutral", label: "Couldn't check" },
};

export async function PlatformWsNeeds({ viewer }: { viewer: Viewer }) {
  const queues = await queuesFor(viewer.id, viewer.role);
  const now = readClock();
  const rows = platformNeeds(queues, now).filter((row) => canOpenAdminHref(viewer.role, row.href));
  return (
    <WsPanel title="Needs a look" count={needsTotal(queues, now)} note="most urgent first · each opens its page, filtered">
      {rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 py-8 text-center">
          <p className="m-0 text-sm font-semibold text-foreground">Nothing needs a look</p>
          <p className="m-0 max-w-[48ch] text-xs text-muted-foreground">Screening, disclosures, calling rules, mail, maintenance, staff sign-in and legal drafts are all clear.</p>
        </div>
      ) : (
        <ul className="m-0 list-none p-0">
          {rows.map((row) => (
            <li key={row.key}>
              <Link href={row.href} className={rowLink}>
                <span className="w-44 shrink-0 truncate font-semibold xl:w-60" title={row.title}>{row.title}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground" title={row.detail}>{row.detail}</span>
                <StatusChip tone={NEED_CHIP[row.tone].tone}>{NEED_CHIP[row.tone].label}</StatusChip>
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WsPanel>
  );
}
