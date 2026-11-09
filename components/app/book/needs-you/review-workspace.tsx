"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { BulkResolve } from "@/components/app/book/needs-you/bulk-resolve";
import { ItemDecide } from "@/components/app/book/needs-you/item-decide";
import { refreshStepCounts } from "@/components/app/step-frame/step-rail";
import { Button } from "@/components/ui/button";
import { cardHead, cardInset, cardSurface } from "@/components/ui/card";
import { ToolbarSearch } from "@/components/ui/data-toolbar";
import { checkboxControl } from "@/components/ui/field";
import { EmptyState, LoadingRows } from "@/components/ui/page-states";
import { SelectMenu } from "@/components/ui/select-menu";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";
import { fileDay } from "@/lib/ingestion/constants";
import type { MatchField, FieldOutcome } from "@/lib/ingestion/policyMatching";
import { ageShort, dollars, KIND_META, matchesSearch, reviewFocus, searchParam, searchWords, type NeedsYouKind } from "@/lib/needsYou/kinds";
import type { QueueItemRow } from "@/lib/ingestion/exceptionQueuesStore";
import type { ItemDetail } from "@/lib/needsYou/store";
import { notify } from "@/lib/notify";

/** One item of the queue, as the server read it. */
export type ReviewItem = { kind: NeedsYouKind; id: string; about: string; why: string; who: string; ageDays: number; href: string; /** lib/needsYou/kinds.ts searchText */ search: string };

/** The queue shows this many at once; the search narrows it. */
const SHOWN = 200;
const keyOf = (item: Pick<ReviewItem, "kind" | "id">) => `${item.kind}:${item.id}`;

/** An answer: what the button says, the key that presses it, and what it does (null = it opens a picker). */
type Answer = { key: string; label: string; primary?: boolean; disabled?: boolean; run: () => void };

/** Posts a decision to the kind's own API. */
async function post(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "That did not save.");
}

/**
 * Book of business › Needs you › Review (round 5, owner 2026-11-03): the queue on the left, one question on the
 * right. Every answer is a big numbered button (keys 1–4, S skips, ↑↓ moves); one press saves through the kind's
 * own API, marks the item done and opens the next. "No sale yet" items can be ticked and answered together
 * (BulkResolve). Kinds with no question of their own here use the item's Decide form in place.
 * `initialQuery`: the search to open on (?q=, passed on from the Needs you list).
 */
export function ReviewWorkspace({ items, startAt, source, backHref, readOnly, initialQuery = "" }: { items: ReviewItem[]; startAt: number; source: string; backHref: string; readOnly: boolean; initialQuery?: string }) {
  const router = useRouter();
  const [done, setDone] = useState<ReadonlyMap<string, string>>(new Map());
  const [currentKey, setCurrentKey] = useState<string | null>(items[startAt] ? keyOf(items[startAt]) : items[0] ? keyOf(items[0]) : null);
  const [query, setQuery] = useState(initialQuery);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const answers = useRef<Answer[]>([]);
  // The question on screen names its answers (for the number keys); a callback, so a child never writes the ref.
  const register = useCallback((list: Answer[]) => { answers.current = list; }, []);

  // The search: policy, client, agent code or file (the list's rule, kinds.ts searchText), kept in ?q=.
  const words = useMemo(() => searchWords(query), [query]);
  const shown = useMemo(() => (words.length ? items.filter((item) => matchesSearch(item.search, words)) : items), [items, words]);
  const search = (next: string) => {
    setQuery(next);
    try {
      const url = new URL(window.location.href);
      const q = searchParam(next);
      if (q) url.searchParams.set("q", q); else url.searchParams.delete("q");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    } catch { /* the queue still narrows */ }
  };
  const left = items.filter((item) => !done.has(keyOf(item))).length;
  // QA 2026-11-03: the question follows the search — the chosen item while it is still listed, else the first match.
  const current = reviewFocus(shown, currentKey, done);
  const leftShown = shown.filter((item) => !done.has(keyOf(item))).length;
  const bulkable = shown.filter((item) => item.kind === "no-sale" && !done.has(keyOf(item)));
  const tickedIds = bulkable.filter((item) => ticked.has(keyOf(item))).map((item) => item.id);

  // "The next" walks the queue as searched, so an answer never jumps to an item the search hides.
  const nextAfter = useCallback((key: string, skip: ReadonlyMap<string, string>) => {
    const at = shown.findIndex((item) => keyOf(item) === key);
    const after = [...shown.slice(at + 1), ...shown.slice(0, Math.max(0, at))];
    return after.find((item) => !skip.has(keyOf(item)) && keyOf(item) !== key) ?? null;
  }, [shown]);

  const finish = useCallback((label: string) => {
    if (!current) return;
    const key = keyOf(current);
    const next = new Map(done).set(key, label);
    setDone(next);
    refreshStepCounts();
    const following = nextAfter(key, next);
    setCurrentKey(following ? keyOf(following) : null);
  }, [current, done, nextAfter]);

  const skip = useCallback(() => {
    if (!current) return;
    const following = nextAfter(keyOf(current), done);
    if (following) setCurrentKey(keyOf(following));
  }, [current, done, nextAfter]);

  // Keys: 1–9 and 0 press the answer with that key, S skips, ↑↓ move through the queue. Never while typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, select, [contenteditable=true]") || event.metaKey || event.ctrlKey || event.altKey)) return;
      if (event.key === "s" || event.key === "S") { event.preventDefault(); skip(); return; }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const list = shown;
        const at = list.findIndex((item) => current && keyOf(item) === keyOf(current));
        const to = list[at + (event.key === "ArrowDown" ? 1 : -1)];
        if (to) { event.preventDefault(); setCurrentKey(keyOf(to)); }
        return;
      }
      const answer = answers.current.find((a) => a.key === event.key && !a.disabled);
      if (answer) { event.preventDefault(); answer.run(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [skip, shown, current]);

  const toggle = (key: string) => setTicked((now) => { const next = new Set(now); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const allTicked = bulkable.length > 0 && bulkable.every((item) => ticked.has(keyOf(item)));
  const total = items.length;
  const pct = total ? Math.round(((total - left) / total) * 100) : 100;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {source && <StatusChip tone="neutral">{source}</StatusChip>}
        <span className="ml-auto text-sm text-muted-foreground tabular-nums">{(total - left).toLocaleString("en-US")} done · {left.toLocaleString("en-US")} left</span>
        <span aria-hidden="true" className="h-1 w-40 overflow-hidden rounded-full bg-[var(--border-strong)]"><span className="block h-full bg-[var(--primary)] transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} /></span>
        <Button asChild variant="outline"><Link href={backHref} onClick={() => router.refresh()}>Done for now</Link></Button>
      </div>

      <div className={cn(cardSurface, "grid min-h-[560px] flex-1 overflow-hidden lg:grid-cols-[340px_minmax(0,1fr)]")}>
        {/* The queue */}
        {/* On a phone the question comes first and the queue below it, capped; side by side from lg. */}
        <div className="order-2 flex min-h-0 flex-col border-t border-[var(--border)] lg:order-none lg:border-r lg:border-t-0">
          <div className="border-b border-[var(--border)] p-3">
            <ToolbarSearch value={query} onChange={search} placeholder="Policy, client, agent code or file" label="Search the queue" className="sm:w-full" />
          </div>
          {bulkable.length > 1 && !readOnly && (
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-xs text-muted-foreground">
              <input type="checkbox" aria-label="Select every No sale yet item" className={checkboxControl} checked={allTicked} onChange={() => setTicked(allTicked ? new Set() : new Set(bulkable.map(keyOf)))} />
              <span>Select all {bulkable.length.toLocaleString("en-US")}</span>
              <span className="ml-auto">Oldest first</span>
            </div>
          )}
          <ul className="m-0 max-h-[40vh] min-h-0 flex-1 list-none overflow-y-auto p-0 lg:max-h-none" aria-label="Queue">
            {shown.slice(0, SHOWN).map((item) => {
              const key = keyOf(item);
              const on = current !== null && keyOf(current) === key;
              const outcome = done.get(key);
              return (
                <li key={key} className={cn("flex items-center gap-3 border-b border-[var(--border)] px-3 py-2.5 transition-[background-color,box-shadow,opacity] duration-[var(--t-panel)]", on && "bg-[var(--surface-alt)] shadow-[inset_3px_0_0_var(--primary)]", outcome && "opacity-50")}>
                  {item.kind === "no-sale" && !readOnly && !outcome
                    ? <input type="checkbox" aria-label={`Select ${item.about}`} className={checkboxControl} checked={ticked.has(key)} onChange={() => toggle(key)} />
                    : <span className="size-4 shrink-0" aria-hidden="true" />}
                  <button type="button" onClick={() => setCurrentKey(key)} aria-current={on ? "true" : undefined} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-semibold text-foreground">{item.about}</span>
                    <span className="block truncate text-xs text-muted-foreground" title={item.why}>{item.why}</span>
                  </button>
                  {outcome ? <StatusChip tone="good">{outcome}</StatusChip> : <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{ageShort(item.ageDays)}</span>}
                </li>
              );
            })}
          </ul>
          {tickedIds.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] bg-[var(--surface-alt)] p-3">
              <span className="text-sm font-semibold text-foreground">{tickedIds.length.toLocaleString("en-US")} selected</span>
              <span className="ml-auto flex gap-2">
                <BulkResolve ids={tickedIds} resolution="not_mine" noun="items" label="Not ours" variant="outline" />
                <BulkResolve ids={tickedIds} resolution="confirm_client" noun="clients" label={`Mark ${tickedIds.length.toLocaleString("en-US")} as mine`} />
              </span>
            </div>
          ) : shown.length > SHOWN ? (
            <p className="m-0 border-t border-[var(--border)] px-3 py-2 text-xs text-muted-foreground">The first {SHOWN} of {shown.length.toLocaleString("en-US")}; search to narrow.</p>
          ) : null}
        </div>

        {/* The question */}
        <div className="order-1 min-w-0 overflow-y-auto lg:order-none">
          {!items.length ? <div className="p-6"><EmptyState title="Nothing to review here" hint="Every item in this list has been decided." action={<Button asChild><Link href={backHref}>Back</Link></Button>} /></div>
            : !current && words.length && left > 0 ? <div className="p-6"><EmptyState title={shown.length ? "Nothing left that matches" : "Nothing matches"} hint={`${left.toLocaleString("en-US")} still wait outside this search.`} action={<Button type="button" onClick={() => search("")}>Clear the search</Button>} /></div>
            : !current ? <div className="p-6"><EmptyState title="All done" hint={`${(total - left).toLocaleString("en-US")} answered.`} action={<Button asChild><Link href={backHref} onClick={() => router.refresh()}>Back</Link></Button>} /></div>
            // The next question slides in from the right, as the queue moves on (§ Motion, Wave 5).
            : <div key={keyOf(current)} data-enter="forward"><Question item={current} readOnly={readOnly} register={register} onDone={finish} onSkip={skip} hasNext={leftShown > 1} /></div>}
        </div>
      </div>
    </div>
  );
}

type Loaded = { state: "loading" } | { state: "ready"; detail: ItemDetail } | { state: "gone"; message: string };

/** One item's question: read its Decide part, then ask it in the kind's own words. */
function Question({ item, readOnly, register, onDone, onSkip, hasNext }: { item: ReviewItem; readOnly: boolean; register: (list: Answer[]) => void; onDone: (label: string) => void; onSkip: () => void; hasNext: boolean }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(`/api/app/needs-you/item?kind=${encodeURIComponent(item.kind)}&id=${encodeURIComponent(item.id)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as { detail?: ItemDetail; error?: string };
        if (!live) return;
        setLoaded(response.ok && data.detail ? { state: "ready", detail: data.detail } : { state: "gone", message: data.error ?? "This item couldn't be opened." });
      })
      .catch(() => live && setLoaded({ state: "gone", message: "This item couldn't be opened. Try again." }));
    register([]);
    return () => { live = false; register([]); };
  }, [item.kind, item.id, register]);

  /** Saves, says so, and moves on; a refusal names the problem and leaves the item open. */
  const save = useCallback(async (url: string, body: unknown, label: string, said: string) => {
    if (busy || readOnly) return;
    setBusy(true);
    try {
      await post(url, body);
      notify.done(said);
      onDone(label);
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That did not save.");
      setBusy(false);
    }
  }, [busy, readOnly, onDone]);

  const head = (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <StatusChip tone="warning">{KIND_META[item.kind].label}</StatusChip>
      <span>{item.about}</span>
      <span>· waiting {ageShort(item.ageDays)} · {item.who}</span>
      <Link href={item.href} className="ml-auto font-medium text-[var(--accent-ink)] hover:underline">Its page · the row as sent</Link>
    </div>
  );

  if (loaded.state === "loading") return <div className="flex flex-col gap-4 p-6">{head}<LoadingRows rows={4} columns={3} /></div>;
  if (loaded.state === "gone") {
    return (
      <div className="flex flex-col gap-4 p-6">{head}
        <p className="m-0 text-sm text-muted-foreground">{loaded.message}</p>
        <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => onDone("Closed")}>Next</Button></div>
      </div>
    );
  }
  const detail = loaded.detail;
  const footer = (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span>An answer saves and opens the next.</span>
      {hasNext && <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={onSkip}>Skip <Kbd>S</Kbd></Button>}
    </div>
  );

  if (detail.kind === "no-sale" && "queue" in detail) return <div className="flex flex-col gap-5 p-4 sm:p-6">{head}<NoSale detail={{ kind: "no-sale", queue: detail.queue }} busy={busy} readOnly={readOnly} register={register} save={save} />{footer}</div>;
  if (detail.kind === "pick-client") return <div className="flex flex-col gap-5 p-4 sm:p-6">{head}<PickClient detail={detail} busy={busy} readOnly={readOnly} register={register} save={save} />{footer}</div>;
  // Every other kind: its question in words, then the item's own Decide form in place (no number keys).
  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">{head}
      <h2 className="m-0 text-card-title text-[var(--ink)]">{item.why}</h2>
      <ItemDecide detail={detail} nextHref={null} listHref={item.href} readOnly={readOnly} inline={{ hasNext, onDone: () => onDone("Saved"), onSkip }} />
    </div>
  );
}

/** The key that presses an answer. There is no kit key cap (components/ui), so this one is drawn from tokens only. */
const Kbd = ({ children }: { children: ReactNode }) => <kbd className="rounded-badge border border-[var(--border)] border-b-2 bg-[var(--surface)] px-1.5 font-mono text-xs text-muted-foreground">{children}</kbd>;

/** An answer button (the kit's 36px Button, full width) with its key on the right. */
function AnswerButton({ answer, busy }: { answer: Answer; busy: boolean }) {
  return (
    <Button type="button" variant={answer.primary ? "default" : "outline"} disabled={busy || answer.disabled} onClick={answer.run} className="w-full justify-between">
      <span className="truncate">{answer.label}</span><Kbd>{answer.key}</Kbd>
    </Button>
  );
}

type Save = (url: string, body: unknown, label: string, said: string) => Promise<void>;

/** A side-by-side line of the evidence. */
const Line = ({ label, file, ours }: { label: string; file: ReactNode; ours: ReactNode }) => (
  <>
    <dt className="border-b border-[var(--border)] px-3 py-2 text-sm text-muted-foreground">{label}</dt>
    <dd className="m-0 border-b border-[var(--border)] px-3 py-2 text-sm text-foreground">{file}</dd>
    <dd className="m-0 border-b border-[var(--border)] px-3 py-2 text-sm text-muted-foreground">{ours}</dd>
  </>
);

/**
 * A pick from a list for an answer that needs one more choice (someone already in Insurvas, the sale): the
 * kit's SelectMenu, focused as it opens so Enter or a click shows the searchable list. Picking saves.
 */
function PickOne({ label, rows, busy, onPick }: { label: string; rows: Array<{ id: string; name: string; hint: string }>; busy: boolean; onPick: (id: string, name: string) => void }) {
  const id = useId();
  useEffect(() => { document.getElementById(id)?.focus(); }, [id]);
  const options = [{ value: "", label: "Choose one", disabled: true }, ...rows.map((row) => ({ value: row.id, label: row.name, description: row.hint || undefined }))];
  return (
    <SelectMenu
      id={id}
      label={label}
      value=""
      options={options}
      disabled={busy}
      onChange={(value) => { const row = rows.find((r) => r.id === value); if (row) onPick(row.id, row.name); }}
      searchPlaceholder="Search by name"
      matchTriggerWidth
      panelAlign="start"
      className="w-full"
    />
  );
}

// ─── No sale yet ────────────────────────────────────────────────────────────────────────────────

function NoSale({ detail, busy, readOnly, register, save }: { detail: { kind: "no-sale"; queue: QueueItemRow }; busy: boolean; readOnly: boolean; register: (list: Answer[]) => void; save: Save }) {
  const q = detail.queue;
  const insured = [q.payload?.insured?.first_name, q.payload?.insured?.last_name].filter(Boolean).join(" ") || q.contact?.name || "this client";
  const [picking, setPicking] = useState<"client" | "sale" | null>(null);
  const url = "/api/app/exceptions";
  const base = { action: "resolve", item_id: q.id };
  const list: Answer[] = [
    { key: "1", primary: true, label: `Yes, ${insured} is my client`, disabled: !q.contact || readOnly, run: () => void save(url, { ...base, resolution: "confirm_client" }, "Mine", `${insured} confirmed.`) },
    { key: "2", label: "It's someone already in Insurvas…", disabled: readOnly || !(q.choices.contacts ?? []).length, run: () => setPicking(picking === "client" ? null : "client") },
    { key: "3", label: "Link it to a sale…", disabled: readOnly || !(q.choices.deals ?? []).length, run: () => setPicking(picking === "sale" ? null : "sale") },
    { key: "4", label: "Not ours", disabled: readOnly, run: () => void save(url, { ...base, resolution: "not_mine" }, "Not ours", "Handed on.") },
  ];
  useEffect(() => register(list));
  const picker = (label: string, rows: Array<{ id: string; name: string; hint: string }>, onPick: (id: string, name: string) => void) => (
    <PickOne key={label} label={label} rows={rows} busy={busy} onPick={onPick} />
  );

  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-card-title text-[var(--ink)]">Is {insured} your client?</h2>
        <p className="m-0 text-sm text-muted-foreground">{q.carrierName ?? "The carrier"} has this policy, but no sale or application in Insurvas matches it. A client was made from the carrier’s row.</p>
      </div>
      <dl className={cn(cardInset, "m-0 grid grid-cols-[minmax(0,5.5rem)_minmax(0,1fr)_minmax(0,1fr)] overflow-hidden sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)_minmax(0,1fr)]")}>
        <dt className={cn(cardHead, "border-b border-[var(--border)] px-3 py-2")} />
        <dd className={cn(cardHead, "m-0 border-b border-[var(--border)] px-3 py-2 text-label text-muted-foreground")}>The carrier’s file</dd>
        <dd className={cn(cardHead, "m-0 border-b border-[var(--border)] px-3 py-2 text-label text-muted-foreground")}>In Insurvas now</dd>
        <Line label="Name" file={insured} ours={q.contact ? `${q.contact.name}${q.contact.provisional ? " (made from the file)" : ""}` : "No client could be made"} />
        <Line label="Born" file={q.payload?.insured?.dob ? fileDay(q.payload.insured.dob) : "—"} ours="—" />
        <Line label="Premium" file={q.payload?.premium_cents != null ? `${dollars(q.payload.premium_cents)} / month` : "—"} ours="—" />
        <Line label="Face" file={dollars(q.payload?.face_cents ?? null)} ours="—" />
        <Line label="Policy" file={<span className="font-mono text-xs">{q.policyNumber ?? "—"}</span>} ours={`file of ${fileDay(q.payload?.file_date ?? null)}`} />
        <Line label="Writing agent" file={q.assigneeName} ours={q.assignedRole?.replaceAll("_", " ") ?? "—"} />
      </dl>
      <div className="grid gap-2">
        {list.map((answer) => (
          <div key={answer.key} className="flex flex-col gap-2">
            <AnswerButton answer={answer} busy={busy} />
            {answer.key === "2" && picking === "client" && picker("Someone already in Insurvas", (q.choices.contacts ?? []).map((c) => ({ id: c.id, name: c.name, hint: c.dob ? `born ${fileDay(c.dob)}` : "" })), (id, name) => void save(url, { ...base, resolution: "link_existing_client", contact_id: id }, "Linked", `Linked to ${name}.`))}
            {answer.key === "3" && picking === "sale" && picker("The sale", (q.choices.deals ?? []).map((d) => ({ id: d.id, name: d.name, hint: `${d.why ? `${d.why} · ` : ""}sale of ${fileDay(d.date)}` })), (id, name) => void save(url, { ...base, resolution: "found_the_sale", deal_id: id }, "Linked", `Linked to ${name}'s sale.`))}
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Pick the client ────────────────────────────────────────────────────────────────────────────

const FIELD_WORDS: Array<[MatchField, string]> = [["surname", "name"], ["dob", "born"], ["phone", "phone"], ["premium", "premium"], ["face", "face"]];

function PickClient({ detail, busy, readOnly, register, save }: { detail: Extract<ItemDetail, { kind: "pick-client" }>; busy: boolean; readOnly: boolean; register: (list: Answer[]) => void; save: Save }) {
  const row = detail.carrierRow;
  const url = "/api/app/policy-matching";
  const pick = (index: number | null, name: string) => void save(url, { action: "resolve", review_id: detail.reviewId, candidate: index }, index === null ? "New client" : "Linked", index === null ? "Kept as a new client." : `Linked to ${name}.`);
  const best = detail.candidates.reduce((top, c) => (c.score > (top?.score ?? -1) ? c : top), null as (typeof detail.candidates)[number] | null);
  const list: Answer[] = [
    ...detail.candidates.slice(0, 9).map((c, i) => ({ key: String(i + 1), label: "This is the one", primary: c === best, disabled: readOnly, run: () => pick(c.index, c.name) })),
    { key: "0", label: "None of them: keep it as a new client", disabled: readOnly, run: () => pick(null, "") },
  ];
  useEffect(() => register(list));
  const mark = (outcome: FieldOutcome | undefined) => (outcome === "match" ? "text-[var(--success-ink)]" : outcome === "mismatch" ? "text-[var(--error-ink)]" : outcome === "partial" ? "text-[var(--warning-ink)]" : "text-muted-foreground");
  const value = (field: MatchField, c: (typeof detail.candidates)[number]) =>
    field === "surname" ? c.name : field === "dob" ? (c.dob ? fileDay(c.dob) : "—") : field === "phone" ? c.phone ?? "—" : field === "premium" ? dollars(c.premiumCents) : dollars(c.faceCents);

  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-card-title text-[var(--ink)]">Which sale is policy {detail.policyNumber}?</h2>
        <p className="m-0 text-sm text-muted-foreground">The file says <strong className="font-semibold text-foreground">{row.name} · {dollars(row.premiumCents)} / month · {dollars(row.faceCents)} face{row.agentIdentifier ? ` · agent ${row.agentIdentifier}` : ""}</strong></p>
      </div>
      {detail.candidates.length === 0 ? <p className="m-0 text-sm text-muted-foreground">No sale or application for this carrier in the 14 days before the file looks like this policy.</p> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {detail.candidates.slice(0, 9).map((c, i) => (
            <div key={c.index} className={cn(cardInset, "flex flex-col gap-1.5 p-3", c === best && "border-[var(--primary)]")}>
              <span className="truncate text-sm font-semibold text-foreground">{c.name || (c.type === "deal_flow" ? "A sale" : "An application")}</span>
              <span className="text-xs text-muted-foreground">{c.type === "deal_flow" ? "sale" : "application"} of {fileDay(c.date)} · score {c.score}</span>
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-xs">
                {FIELD_WORDS.map(([field, word]) => <li key={field} className={mark(c.fields[field])}>{c.fields[field] === "match" ? "✓" : c.fields[field] === "mismatch" ? "✕" : "~"} {word} {value(field, c)}</li>)}
              </ul>
              <AnswerButton answer={list[i]} busy={busy} />
            </div>
          ))}
        </div>
      )}
      <AnswerButton answer={list[list.length - 1]} busy={busy} />
    </>
  );
}
