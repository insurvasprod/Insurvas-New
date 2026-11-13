"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { Switch } from "@/components/ui/field";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { EmptyState, ErrorState } from "@/components/ui/page-states";
import { SettingsSectionHeader, SettingsStack } from "@/components/app/settings/primitives";
import { useInboundSettings, type InboundSettings } from "@/components/app/inbound-settings-cards";
import { useSolo } from "@/components/app/solo-context";
import { DurationStepper, Ladder, type RungEffects } from "@/components/app/settings/calling/ladder";
import { SaveBand, StatusLine, type StatusTone } from "@/components/app/settings/calling/parts";
import { type LadderValues } from "@/lib/queueSla/ladder";
import { slaJobNotice, type SlaJobState } from "@/lib/queueSla/digestView";
import { durationLabel, ladderChanges, RUNG_LABEL } from "@/lib/queueSla/scale";
import { cn } from "@/lib/utils";

/**
 * LA-1.23 · Settings › Inbound settings — round 8 "the waiting ladder" (owner: "Build all four", 2026-11-12).
 *
 * One card with a section index and one save band. The four thresholds (seconds, walked by
 * `run_unclaimed_sla`) are a timeline with rungs you drag, step or pick from chips — never typed — and
 * a sentence under it reads the whole wait back. Who hears about it is grouped by rung, buffer agents
 * are the people who hold the Assistant role, and who gets the next transfer is its own section.
 *
 * Two saves sit behind the one band: the ladder (/api/app/queue-sla-settings) and the alerts, buffer
 * handoff and routing (/api/app/inbound-settings). If one half fails, the status line names it and
 * keeps that half's edits; the bell is never the only place it is said.
 */

type Values = LadderValues;

/** Each rung's hint says what it does on the floor — the one place a reader learns it. */
const FIELDS: Array<{ key: keyof Values; label: string; help: string }> = [
  { key: "warn", label: "Warn after", help: "The row turns amber and sorts to the top" },
  { key: "escalate", label: "Escalate after", help: "An alert, and the lead is offered more widely" },
  { key: "partner", label: "Partner notice after", help: "Their pipeline row says nobody claimed it" },
  { key: "expire", label: "Expire after", help: "It leaves the active queue marked expired" },
];

type Week = { claimed: number; medianClaimSeconds: number | null; expired: number } | null;
type Member = { id: string; name: string; role: string; acceptedAt: string | null };
type Team = { buffers: Member[]; seats: { used: number; max: number | null } } | "error" | null;

const SECTIONS = [
  { id: "ladder", label: "The ladder" },
  { id: "alerts", label: "Who hears about it" },
  { id: "buffers", label: "Buffer agents" },
  { id: "routing", label: "Who gets the next transfer" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";

export function QueueSlaSettings() {
  const [saved, setSaved] = useState<Values | null>(null);
  const [values, setValues] = useState<Values | null>(null);
  const [lastWeek, setLastWeek] = useState<Week>(null);
  const [nurtureReady, setNurtureReady] = useState(false);
  const [jobState, setJobState] = useState<SlaJobState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [team, setTeam] = useState<Team>(null);
  const [active, setActive] = useState<SectionId>("ladder");
  const scroller = useRef<HTMLDivElement | null>(null);
  const inbound = useInboundSettings();
  const solo = useSolo();

  const load = useCallback(
    () =>
      fetch("/api/app/queue-sla-settings", { cache: "no-store" })
        .then(async (response) => {
          const body = await response.json().catch(() => null);
          if (!response.ok) throw new Error(body?.error ?? "Could not load queue SLA settings");
          const next: Values = {
            warn: body.settings.warn_after_seconds,
            escalate: body.settings.escalate_after_seconds,
            partner: body.settings.partner_notify_after_seconds,
            expire: body.settings.expire_after_seconds,
          };
          setSaved(next);
          setValues(next);
          setLastWeek(body.lastSevenDays ? { claimed: body.lastSevenDays.claimed, medianClaimSeconds: body.lastSevenDays.medianClaimSeconds, expired: body.lastSevenDays.expired } : null);
          setNurtureReady(body.schema?.nurtureOnExpiry === true);
          setJobState(typeof body.job?.state === "string" ? (body.job.state as SlaJobState) : null);
          setLoadError("");
        })
        .catch((reason: unknown) => setLoadError(reason instanceof Error ? reason.message : "Could not load queue SLA settings"))
        .then(() => setLoading(false)),
    [],
  );

  useEffect(() => { void load(); }, [load]);

  // Buffer agents are the people who hold the Assistant role (Team & access). Read, never edited here.
  useEffect(() => {
    let live = true;
    fetch("/api/app/team", { cache: "no-store" })
      .then(async (response) => (response.ok ? response.json() : Promise.reject(new Error("unavailable"))))
      .then((body: { members?: Member[]; bufferSeats?: { used: number; max: number | null } }) => {
        if (!live) return;
        const buffers = (body.members ?? []).filter((member) => member.role === "assistant" && member.acceptedAt);
        setTeam({ buffers, seats: body.bufferSeats ?? { used: buffers.length, max: null } });
      })
      .catch(() => live && setTeam("error"));
    return () => { live = false; };
  }, []);

  const ladderDirty = Boolean(saved && values && JSON.stringify(values) !== JSON.stringify(saved));
  const dirty = ladderDirty || inbound.dirty;

  /** True when everything saved; on false the status line names the half that did not. */
  async function save(): Promise<boolean> {
    if (!values) return false;
    setError("");
    setSaving(true);
    let ladderSaved = !ladderDirty;
    try {
      if (ladderDirty) {
        const response = await fetch("/api/app/queue-sla-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setError(inbound.dirty ? `The ladder didn't save (${body?.error ?? "try again"}), so nothing else was saved either. Your choices are kept.` : body?.error ?? "Could not save queue SLA settings");
          return false;
        }
        ladderSaved = true;
      }
      if (inbound.dirty && !(await inbound.save())) {
        setError(ladderDirty ? "The ladder saved, but the alerts, buffer agents and routing didn't. Your choices are kept." : inbound.error || "Could not save the inbound settings.");
        if (ladderDirty) await load();
        return false;
      }
      if (!ladderDirty) { notify.done("Inbound settings saved"); return true; }
      notify.done("Queue SLA settings saved");
      // Re-read, so the status line's figures are counted against the threshold just saved, not the old one.
      await load();
      return true;
    } catch {
      setError(ladderSaved && inbound.dirty ? "The ladder saved, but the alerts, buffer agents and routing didn't. Your choices are kept." : "Could not save. Check your connection and try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    if (saved) setValues(saved);
    inbound.reset();
    setError("");
  }

  function jump(id: SectionId) {
    setActive(id);
    scroller.current?.querySelector(`[data-section="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function onScroll() {
    const root = scroller.current;
    if (!root) return;
    const top = root.getBoundingClientRect().top;
    let current: SectionId = "ladder";
    for (const section of SECTIONS) {
      const element = root.querySelector(`[data-section="${section.id}"]`);
      if (element && element.getBoundingClientRect().top - top <= 48) current = section.id;
    }
    if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4) current = SECTIONS[SECTIONS.length - 1].id;
    if (current !== active) setActive(current);
  }

  const header = <SettingsSectionHeader actions={<Button asChild variant="outline"><Link href="/app/inbound">See today&rsquo;s transfers</Link></Button>} />;

  if (loading)
    return (
      <SettingsStack className="min-h-0 flex-1 gap-3">
        {header}
        <div className={cn(cardSurface, "min-h-[260px] p-4")} aria-busy="true" aria-label="Loading inbound settings">
          <div className="mt-10 h-2 animate-pulse rounded-full bg-[var(--surface-alt)]" />
          <div className="mt-3.5 flex justify-around">{[0, 1, 2, 3].map((index) => <div key={index} className="h-6 w-16 animate-pulse rounded-md bg-[var(--surface-alt)]" />)}</div>
          <div className="mt-5 h-3 animate-pulse rounded-md bg-[var(--surface-alt)]" />
          <div className="mt-2 h-3 w-[70%] animate-pulse rounded-md bg-[var(--surface-alt)]" />
        </div>
      </SettingsStack>
    );
  if (loadError || !values || !saved)
    return (
      <SettingsStack className="min-h-0 flex-1 gap-3">
        {header}
        <StatusLine tone="danger" action={<Button type="button" variant="link" size="xs" className="h-auto px-0 text-xs text-[var(--error-ink)] underline" onClick={() => { setLoading(true); void load(); }}>Retry</Button>}>
          Couldn&rsquo;t load inbound settings. Transfers still use the last saved ladder.
        </StatusLine>
        <div className={cn(cardSurface, "min-h-[260px]")}>
          <ErrorState title="Couldn't load inbound settings" detail={loadError || "Could not load queue SLA settings"} action={<Button type="button" variant="outline" onClick={() => { setLoading(true); void load(); }}>Try again</Button>} />
        </div>
      </SettingsStack>
    );

  const draft = inbound.draft;
  const inboundOn = inbound.available && Boolean(draft && inbound.loaded);
  const locked = saving || !inbound.loaded?.ready;
  const set = (patch: Partial<InboundSettings>) => inbound.setDraft((current) => (current ? { ...current, ...patch } : current));
  const timeout = Number(inbound.timeoutText) || 30;
  const effects: RungEffects = {
    warn: FIELDS[0].help,
    escalate: FIELDS[1].help,
    partner: FIELDS[2].help,
    expire: nurtureReady ? "It leaves the active queue and becomes a nurture lead" : FIELDS[3].help,
  };
  const ladderEdits = ladderChanges(saved, values);
  const inboundEdits = inbound.loaded && draft
    ? (Object.keys(draft) as (keyof InboundSettings)[]).filter((key) => (key === "handoffTimeoutSeconds" ? timeout !== inbound.loaded?.settings.handoffTimeoutSeconds : draft[key] !== inbound.loaded?.settings[key])).length
    : 0;
  const count = ladderEdits.length + inboundEdits;
  const visible = SECTIONS.filter((section) => (section.id === "routing" ? inboundOn && !solo : section.id === "ladder" ? true : inboundOn));

  /* ── the status line ──────────────────────────────────────────────── */
  const jobNotice = jobState ? slaJobNotice(jobState) : null;
  let tone: StatusTone = "good";
  let line: ReactNode[];
  let action: ReactNode = null;
  if (error) {
    tone = "danger";
    line = [error];
    action = <Button type="button" variant="link" size="xs" className="h-auto px-0 text-xs text-[var(--error-ink)] underline" onClick={() => void save()}>Try again</Button>;
  } else if (dirty) {
    tone = "warning";
    line = [
      `${count || 1} unsaved ${count === 1 ? "change" : "changes"}`,
      ...ladderEdits.map((edit) => `${RUNG_LABEL[edit.rung]} moves from ${durationLabel(edit.from)} to ${durationLabel(edit.to)}`),
      ...(inboundEdits ? ["alerts, buffer agents or routing"] : []),
    ];
  } else {
    line = [
      "Saved",
      lastWeek
        ? `last 7 days ${lastWeek.claimed} ${lastWeek.claimed === 1 ? "transfer" : "transfers"} claimed${lastWeek.medianClaimSeconds != null ? `, median wait ${durationLabel(lastWeek.medianClaimSeconds)}` : ""}, ${lastWeek.expired} expired`
        : null,
    ].filter(Boolean) as string[];
    if (jobNotice) { tone = jobNotice.tone === "error" ? "danger" : "warning"; line.push(jobNotice.text.replace(/\.$/, "")); }
    if (inbound.available && inbound.loaded && !inbound.loaded.ready) { tone = tone === "danger" ? tone : "warning"; line.push("alerts, buffer handoff and routing need a database update; transfers work as they always have"); }
    if (inbound.error && !inbound.dirty) { tone = "danger"; line.push(inbound.error.replace(/\.$/, "")); }
  }

  const story = (
    <p className="m-0 mt-1.5 rounded-[10px] bg-[var(--surface-alt)] px-3.5 py-2.5 text-sm text-[var(--body)]">
      A transfer waits for an agent to claim it. At <b className="text-[var(--ink)]">{durationLabel(values.warn)}</b> its row turns amber and sorts to the top.
      At <b className="text-[var(--ink)]">{durationLabel(values.escalate)}</b> an alert goes out and it&rsquo;s offered more widely{inboundOn && team && team !== "error" && team.buffers.length ? ", buffer agents included" : ""}.
      At <b className="text-[var(--ink)]">{durationLabel(values.partner)}</b> the partner who sent it sees that nobody claimed it.
      At <b className="text-[var(--ink)]">{durationLabel(values.expire)}</b> it {nurtureReady ? "leaves the active queue and becomes a nurture lead" : "leaves the active queue, marked expired"}.
    </p>
  );

  return (
    <SettingsStack className="min-h-0 flex-1 gap-3">
      {header}
      <LeaveGuard dirty={dirty} onSave={save} onDiscard={discard} what="the inbound settings" />
      <StatusLine tone={tone} action={action}>{line.map((part, index) => <span key={index}>{index > 0 ? " · " : ""}{part}</span>)}</StatusLine>

      <section aria-label="Inbound settings" className={cn(cardSurface, "flex min-h-0 flex-1 overflow-hidden lg:min-h-[600px]")}>
        <nav aria-label="Sections" className="w-[180px] shrink-0 border-r border-border py-3 pl-3.5 max-lg:hidden">
          {visible.map((section) => (
            <button
              key={section.id}
              type="button"
              aria-current={active === section.id ? "true" : undefined}
              onClick={() => jump(section.id)}
              className={cn("block w-full rounded-md px-2.5 py-1.5 text-left text-sm", active === section.id ? "bg-[var(--primary-soft)] font-semibold text-[var(--accent-ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]")}
            >
              {section.label}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            <Block id="ladder" title="When a transfer waits" sub="A transfer starts at 0 the moment it can be claimed. Each rung fires once if nobody has claimed it yet. Drag a rung, use − and +, or click it.">
              <Ladder values={values} editable={!saving} onChange={(next) => { setValues(next); setError(""); }} effects={effects} label="The waiting ladder" />
              {story}
            </Block>

            {inboundOn && draft && (
              <>
                <Block id="alerts" title="Who hears about it" sub="Grouped by rung. Agents always see the wait on the claim card.">
                  <Group title="When it arrives" />
                  <Row title="Agents" sub="The “new lead waiting” alert to owners, producers and buffer agents" end={<><span className="text-xs text-[var(--muted)]">In the app</span><Switch id="inbound-alert-new" label="Alert agents when a transfer arrives" checked={draft.alertNewTransfer} disabled={locked} onChange={(next) => set({ alertNewTransfer: next })} /></>} />
                  <Group title="At Escalate" time={durationLabel(values.escalate)} />
                  <Row title="Owners, producers and buffer agents" sub="Offered the transfer, with an alert" end={<><span className="text-xs text-[var(--muted)]">In the app · always</span><Switch label="Escalation alert in the app, always on" checked disabled /></>} lock />
                  <Row title="The owners" sub="Each owner can still turn it off for themselves in Notifications" end={<><span className="text-xs text-[var(--muted)]">By email</span><Switch id="inbound-email-owners" label="Email the owners when a transfer escalates" checked={draft.emailOwnersOnEscalation} disabled={locked} onChange={(next) => set({ emailOwnersOnEscalation: next })} /></>} />
                  <Group title="At Partner notice" time={durationLabel(values.partner)} />
                  <Row title="The partner who sent it" sub="Their pipeline row says nobody claimed it" end={<><span className="text-xs text-[var(--muted)]">Always</span><Switch label="Partner notice, always on" checked disabled /></>} lock />
                  <Group title="At Expire" time={durationLabel(values.expire)} />
                  <Row title={nurtureReady ? "Becomes a nurture lead" : "Leaves the active queue"} sub={nurtureReady ? "The dialer works it like any other lead from then on" : "Marked expired; an owner can reopen it from the transfer inbox"} end={<><span className="text-xs text-[var(--muted)]">Always</span><Switch label="Expiry, always on" checked disabled /></>} lock />
                </Block>

                <Block id="buffers" title="Buffer agents" sub="People with the Assistant role. They take the call first, then hand it to a licensed agent.">
                  {team === null ? (
                    <div className="h-9 w-64 animate-pulse rounded-full bg-[var(--surface-alt)]" aria-busy="true" aria-label="Reading your team" />
                  ) : team === "error" ? (
                    <p className="m-0 text-xs text-[var(--muted)]">Couldn&rsquo;t read your team here. <Link className="font-medium text-[var(--accent-ink)] hover:underline" href="/app/settings#team-access">Team &amp; access</Link> lists them.</p>
                  ) : team.buffers.length === 0 ? (
                    <div className={cn(cardSurface, "max-w-[520px]")}>
                      <EmptyState title="No buffer agents" hint="After Escalate, transfers keep ringing the main line only. Add someone who can step in." action={<Button asChild variant="outline"><Link href="/app/settings#team-access">+ Add a buffer agent</Link></Button>} />
                    </div>
                  ) : (
                    <>
                      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                        {team.buffers.map((member) => (
                          <li key={member.id} className="inline-flex items-center gap-2 rounded-full border border-border bg-card py-[3px] pr-3 pl-[3px] text-sm text-[var(--ink)]">
                            <span aria-hidden="true" className="inline-grid size-7 place-items-center rounded-full bg-[var(--highlight-soft)] text-xs font-bold text-[var(--highlight-ink)]">{initials(member.name)}</span>
                            {member.name}
                          </li>
                        ))}
                        <li>
                          <Button asChild variant="outline" size="sm" className="border-dashed text-[var(--accent-ink)]"><Link href="/app/settings#team-access">+ Add a buffer agent</Link></Button>
                        </li>
                      </ul>
                      <p className="m-0 mt-1.5 text-xs text-[var(--muted)]">
                        {team.seats.max == null ? `${team.seats.used} buffer ${team.seats.used === 1 ? "seat" : "seats"} used` : `${team.seats.used} of ${team.seats.max} buffer seats used`} ·{" "}
                        <Link className="font-medium text-[var(--accent-ink)] hover:underline" href="/app/settings#team-access">Team &amp; access</Link>
                      </p>
                    </>
                  )}
                  <Row
                    title="The licensed agent has this long to accept"
                    sub="After that the offer lapses and the buffer can offer someone else"
                    end={
                      <DurationStepper
                        label="Time to accept a handoff"
                        value={timeout}
                        disabled={locked}
                        canDown={timeout > 5}
                        canUp={timeout < 300}
                        onStep={(direction) => inbound.setTimeoutText(String(Math.min(300, Math.max(5, direction === 1 ? timeout + (timeout >= 60 ? 15 : 5) : timeout - (timeout > 60 ? 15 : 5)))))}
                      />
                    }
                  />
                </Block>

                {!solo && (
                  <Block id="routing" title="Who gets the next transfer">
                    <Row title="Only agents licensed in the caller’s state" sub="Buffer agents are not licensed and still take any caller" end={<Switch id="inbound-licensed-only" label="Only agents licensed in the caller's state" checked={draft.licensedOnly} disabled={locked} onChange={(next) => set({ licensedOnly: next })} />} />
                    <Row title="Order" sub="Take next and the claim card hand out the longest wait first" end={<span className="text-sm text-[var(--body)]">Longest waiting first</span>} />
                    <Row title="Skip agents on a break" sub="Someone set to On break or Off on the floor is not handed a transfer until they are Ready again" end={<Switch id="inbound-skip-break" label="Skip agents on a break" checked={draft.skipOnBreak} disabled={locked} onChange={(next) => set({ skipOnBreak: next })} />} />
                  </Block>
                )}
              </>
            )}
          </div>
          <SaveBand
            count={dirty ? Math.max(1, count) : 0}
            idle="Everything on this page saves together"
            saving={saving}
            onDiscard={discard}
            save={
              <Button data-guide="queue-sla-save" type="button" size="sm" disabled={!dirty || saving || Boolean(inbound.dirty && inbound.timeoutProblem)} onClick={() => void save()}>
                {saving ? "Saving…" : "Save"}
              </Button>
            }
          />
        </div>
      </section>
    </SettingsStack>
  );
}

function Block({ id, title, sub, children }: { id: SectionId; title: string; sub?: string; children: ReactNode }) {
  return (
    <section data-section={id} aria-label={title} className="scroll-mt-2 border-t border-border py-4 first:border-t-0">
      <h4 className="m-0 text-base font-semibold text-[var(--ink)]">{title}</h4>
      {sub && <p className="m-0 mt-0.5 mb-3 text-xs text-[var(--muted)]">{sub}</p>}
      {children}
    </section>
  );
}

function Group({ title, time }: { title: string; time?: string }) {
  return (
    <h5 className="m-0 mt-3.5 mb-1.5 flex items-center gap-2 text-xs font-semibold text-[var(--muted)]">
      {title}
      {time && <span className="rounded-[5px] bg-[var(--surface-alt)] px-1.5 font-medium">{time}</span>}
    </h5>
  );
}

function Row({ title, sub, end, lock = false }: { title: string; sub?: string; end: ReactNode; lock?: boolean }) {
  return (
    <div data-locked={lock || undefined} className="flex items-center gap-3 border-b border-border py-2 last:border-b-0">
      <div className="min-w-0">
        <b className="block text-sm font-medium text-[var(--ink)]">{title}</b>
        {sub && <small className="block text-xs text-[var(--muted)]">{sub}</small>}
      </div>
      <span className="ml-auto flex shrink-0 items-center gap-2">{end}</span>
    </div>
  );
}
