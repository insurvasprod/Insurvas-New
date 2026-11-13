"use client";

/**
 * Settings › Sales process › Overview (round 8, board A "One page, step map", 2026-11-12).
 *
 * The call in order as a strip, then one tile per step saying what is set up there and, in gold, what needs
 * you; a step with nothing to set up says so quietly. Beside it, "Needs you": every unpublished draft, every
 * pair still quoting on the Insurvas default, every field the autofill map can't place, every disclosure draft
 * and every stage move to check, each opening its tab on the record. Try a case (the page's one gold button)
 * runs a made-up case through the live disclosure rules. It reads what each tab reads; nothing here saves.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";
import { PIPELINE_SYNC_KEYS } from "@/lib/applications/settingsFixtures";
import { attention, documents } from "@/lib/salesSettings/disclosureLibrary";
import type { DisclosureLibrary } from "@/lib/salesSettings/disclosures";
import { agoText, countPairs, healthDrafts, lastChange, pairName, pairsOnInsurvasDefault, type NeedsItem, type SalesProcessTab } from "@/lib/salesSettings/salesProcess";
import type { SalesSettingsView } from "@/lib/salesSettings/settings";
import type { StageMapView } from "@/lib/salesSettings/stageMap";
import { mapChecks } from "@/lib/salesSettings/stageMapChecks";
import { fieldSetEntries, questionCount } from "@/lib/salesSettings/templateDefinition";
import { unplacedKeys } from "@/lib/salesSettings/fieldSetView";
import type { TemplateRowView, TemplatesPayload } from "@/lib/salesSettings/views";

import { SettingsSectionHeader } from "@/components/app/settings/primitives";
import { TryACase } from "@/components/app/settings/sales/disclosures-try";
import { useAutofillKeys } from "@/components/app/settings/sales/field-sets";
import { salesApi, useSalesSample } from "@/components/app/settings/sales/shared";
import { sampleTemplates } from "@/components/app/settings/sales/templates-sample";

import { GoldCount, Pane, SelectRow, StatusLine, TabBody, TabFrame, WIDE_SHEET } from "./parts";

type Loaded = {
  uw: TemplatesPayload | null;
  qt: TemplatesPayload | null;
  fs: TemplatesPayload | null;
  settings: SalesSettingsView | null;
  disclosures: DisclosureLibrary | null;
  stages: StageMapView | null;
};

function useOverviewData() {
  const sample = useSalesSample();
  const [data, setData] = useState<Loaded | null>(() => (sample ? { uw: sampleTemplates("underwriting"), qt: sampleTemplates("quotation"), fs: sampleTemplates("application_field_set"), settings: null, disclosures: null, stages: null } : null));
  const [failed, setFailed] = useState(0);
  useEffect(() => {
    if (sample) return;
    let live = true;
    void (async () => {
      const base = "/api/app/settings/sales";
      const [uw, qt, fs, settings, disclosures, stages] = await Promise.all([
        salesApi<TemplatesPayload>(`${base}/templates?kind=underwriting`),
        salesApi<TemplatesPayload>(`${base}/templates?kind=quotation`),
        salesApi<TemplatesPayload>(`${base}/templates?kind=application_field_set`),
        salesApi<SalesSettingsView>(`${base}/settings`),
        salesApi<DisclosureLibrary>(`${base}/disclosures`),
        salesApi<StageMapView>(`${base}/stage-map`),
      ]);
      if (!live) return;
      const got = [uw, qt, fs, settings, disclosures, stages];
      setFailed(got.filter((r) => !r.ok).length);
      setData({
        uw: uw.ok ? uw.data : null, qt: qt.ok ? qt.data : null, fs: fs.ok ? fs.data : null,
        settings: settings.ok ? settings.data : null, disclosures: disclosures.ok ? disclosures.data : null, stages: stages.ok ? stages.data : null,
      });
    })();
    return () => { live = false; };
  }, [sample]);
  return { data, failed, sample };
}

const newest = (list: TemplateRowView[]) => [...list].sort((a, b) => b.version - a.version)[0] ?? null;

/** The carrier application each sold pair uses now, and the asked fields its carrier's autofill map can't place. */
function autofillGaps(fs: TemplatesPayload, mapKeys: Map<string, Set<string>>): NeedsItem[] {
  const out: NeedsItem[] = [];
  const pick = (tenant: boolean, carrierId: string | null, code: string, statuses: string[]) =>
    newest(fs.templates.filter((t) => t.tenantOwned === tenant && (t.carrierId ?? null) === carrierId && t.productCode === code && statuses.includes(t.status)));
  const lineName = new Map(fs.productLines.map((p) => [p.code, p.name]));
  for (const carrier of fs.carriers) {
    const codes = [...new Set(fs.carrierProducts.filter((p) => p.carrierId === carrier.id).map((p) => p.productCode))];
    for (const code of codes) {
      const set = pick(true, carrier.id, code, ["draft"]) ?? pick(true, carrier.id, code, ["published"]) ?? pick(false, carrier.id, code, ["published"]) ?? pick(false, null, code, ["published"]) ?? pick(false, null, "final_expense", ["published"]);
      if (!set) continue;
      const missing = unplacedKeys(fieldSetEntries(set.definition), mapKeys.get(carrier.id) ?? null);
      if (!missing?.length) continue;
      out.push({ key: `fs-${carrier.id}-${code}`, title: `${carrier.name} · ${lineName.get(code) ?? code}`, detail: `${missing.length} application ${missing.length === 1 ? "field" : "fields"} autofill can't place`, tab: "carrier-application", anchor: `fs.${carrier.id}|${code}` });
    }
  }
  return out;
}

type Tile = {
  step: string;
  title: string;
  used?: string;
  what: string;
  facts?: ReactNode;
  tab?: SalesProcessTab;
  href?: string;
  go?: string;
};

export function SalesOverview({ onOpen }: { onOpen: (tab: SalesProcessTab, anchor?: string | null) => void }) {
  const { data, failed, sample } = useOverviewData();
  const mapKeys = useAutofillKeys(Boolean(data?.fs) && !sample);
  const [trying, setTrying] = useState(false);

  const docs = useMemo(() => documents(data?.disclosures?.items ?? []), [data]);

  const needs = useMemo<NeedsItem[]>(() => {
    if (!data) return [];
    const out: NeedsItem[] = [];
    if (data.uw) out.push(...healthDrafts(data.uw.templates));
    if (data.qt) out.push(...pairsOnInsurvasDefault(data.qt));
    if (data.fs && mapKeys) out.push(...autofillGaps(data.fs, mapKeys));
    const att = attention(docs);
    for (const d of att.drafts) out.push({ key: `dd-${d.code}`, title: `${d.draft!.title} v${d.draft!.version}`, detail: "Disclosure draft waiting to be reviewed and published", tab: "disclosures", anchor: `doc.${d.code}` });
    for (const d of att.noRule) out.push({ key: `dr-${d.code}`, title: d.live!.title, detail: "Disclosure is live but never required: it has no rule", tab: "disclosures", anchor: `doc.${d.code}` });
    if (data.stages?.perPipeline) {
      for (const p of data.stages.pipelines) {
        const n = mapChecks(p, { ...data.stages.maps[p.id] }).length;
        if (n) out.push({ key: `sm-${p.id}`, title: p.name, detail: `${n} stage ${n === 1 ? "move" : "moves"} to check`, tab: "stage-moves" });
      }
    }
    return out;
  }, [data, docs, mapKeys]);

  if (!data) {
    return <TabFrame><StatusLine tone="muted">Reading every step</StatusLine><Pane title="The call, step by step"><SectionLoading rows={6} columns={4} label="Loading the sales process" /></Pane></TabFrame>;
  }

  const count = (tab: SalesProcessTab) => needs.filter((n) => n.tab === tab).length;
  const uwOwn = data.uw?.templates.filter((t) => t.tenantOwned && t.status !== "retired") ?? [];
  const uwLive = uwOwn.filter((t) => t.status === "published");
  const pairs = data.qt ? countPairs(data.qt) : null;
  const ageBasis = data.qt?.templates.find((t) => t.tenantOwned && t.status === "published")?.definition?.age_basis === "last" ? "age last birthday" : "age nearest birthday";
  const fsOwn = data.fs?.templates.filter((t) => t.tenantOwned && t.status !== "retired") ?? [];
  const avgFields = fsOwn.length ? Math.round(fsOwn.reduce((n, t) => n + fieldSetEntries(t.definition).length, 0) / fsOwn.length) : null;
  const s = data.settings?.settings ?? null;
  const mapped = data.stages ? (data.stages.perPipeline ? data.stages.pipelines.map((p) => Object.values(data.stages!.maps[p.id] ?? {}).filter(Boolean).length) : [Object.values(data.stages.map).filter(Boolean).length]) : [];
  const mappedMost = mapped.length ? Math.max(...mapped) : 0;
  const carriers = data.qt?.carriers.length ?? data.uw?.carriers.length ?? 0;
  const lines = (data.qt?.productLines ?? []).filter((l) => l.sold !== false).length;

  const gold = (n: number, what: string) => (n ? <><br /><span className="font-semibold text-[var(--highlight-ink)]">{n.toLocaleString("en-US")} {what}</span></> : null);
  const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

  const lanes: { title: string; tiles: (Tile | null)[] }[] = [
    {
      title: "Before and during the interview",
      tiles: [
        { step: "1", title: "Lead form", used: "Step 1 · before the call", what: "What we capture about a new lead.", href: "/app/settings#form-templates", go: "Opens Application forms" },
        { step: "2", title: "Verify", what: "Nothing to set up. The agent confirms name, date of birth and state." },
        {
          step: "3", title: "Health questions", used: "Step 3 · Interview", what: "Questions the agent asks; knockout answers rule a carrier out.", tab: "health-questions", go: "Open Health questions",
          facts: data.uw ? <>{plural(uwLive.length, "live set")} · {plural(uwLive.reduce((n, t) => n + questionCount(t.definition), 0), "question")}{gold(count("health-questions"), count("health-questions") === 1 ? "draft not live yet" : "drafts not live yet")}</> : "Could not be read",
        },
        {
          step: "4", title: "Quote inputs", used: "Step 4 · Quote", what: "What the agent types to get a price, per carrier × product.", tab: "quote-inputs", go: "Open Quote inputs",
          facts: pairs ? <>{pairs.own} of {plural(pairs.sold, "pair")} set · {ageBasis}{gold(count("quote-inputs"), count("quote-inputs") === 1 ? "pair on the Insurvas default" : "pairs on the Insurvas default")}</> : "Could not be read",
        },
      ],
    },
    {
      title: "Filling in the carrier's application",
      tiles: [
        {
          step: "5", title: "Carrier application", used: "Step 5 · Application", what: "Each carrier form: fields Not asked, Optional or Required.", tab: "carrier-application", go: "Open Carrier application",
          facts: data.fs ? <>{plural(fsOwn.length, "form")} of your own{avgFields !== null ? ` · ${avgFields} fields on average` : ""}{gold(needs.filter((n) => n.tab === "carrier-application").length, "forms with fields autofill can't place")}</> : "Could not be read",
        },
        { step: "6", title: "Beneficiaries", what: "Nothing to set up. Who gets paid; shares add to 100%." },
        { step: "7", title: "Payment", what: "Nothing to set up here. The draft-date buffer lives in Quote & case checks." },
        {
          step: "8", title: "Disclosures", used: "Step 8 · Disclosures", what: "What the client hears and agrees to, and when.", tab: "disclosures", go: "Open Disclosures",
          facts: data.disclosures ? <>{plural(docs.length, "document")} · {docs.filter((d) => d.live).length} live{gold(count("disclosures"), count("disclosures") === 1 ? "document needs you" : "documents need you")}</> : "Could not be read",
        },
      ],
    },
    {
      title: "Checks and what happens after",
      tiles: [
        {
          step: "✓", title: "Quote & case checks", used: "Steps 4 + 9 · Quote, Review", what: "One set of agency-wide checks on the result.", tab: "checks", go: "Open checks",
          facts: s ? <>Price band ${s.per1000Band.min.toFixed(2)}–${s.per1000Band.max.toFixed(2)} per $1,000<br />Not appointed: {s.appointmentBlocks ? "block" : "warn"} · buffer {s.draftBufferDays} days</> : "Could not be read",
        },
        { step: "10", title: "Submit", what: "Nothing to set up. Refused while Required fields are empty." },
        {
          step: "→", title: "Stage moves", used: "After submit", what: "Where the lead card goes when the application changes.", tab: "stage-moves", go: "Open Stage moves",
          facts: data.stages ? <>{mappedMost} of {PIPELINE_SYNC_KEYS.length} events mapped · {plural(data.stages.pipelines.length, "pipeline")}{gold(count("stage-moves"), count("stage-moves") === 1 ? "pipeline to check" : "pipelines to check")}</> : "Could not be read",
        },
        null,
      ],
    },
  ];

  const strip: { n: string; label: string; tab?: SalesProcessTab; href?: string }[] = [
    { n: "1", label: "Lead form", href: "/app/settings#form-templates" }, { n: "2", label: "Verify" }, { n: "3", label: "Interview", tab: "health-questions" },
    { n: "4", label: "Quote", tab: "quote-inputs" }, { n: "5", label: "Application", tab: "carrier-application" }, { n: "6", label: "Beneficiaries" },
    { n: "7", label: "Payment" }, { n: "8", label: "Disclosures", tab: "disclosures" }, { n: "9", label: "Review", tab: "checks" }, { n: "10", label: "Submit" },
    { n: "→", label: "Card moves", tab: "stage-moves" },
  ];

  const last = lastChange([
    ...[data.uw, data.qt, data.fs].flatMap((p, i) => (p?.templates ?? []).filter((t) => t.tenantOwned).map((t) => ({ at: t.updatedAt, by: t.editedBy, what: `${["Health questions", "Quote inputs", "Carrier application"][i]}, ${pairName(t)}` }))),
    { at: data.settings?.updatedAt, by: data.settings?.updatedBy, what: "Quote & case checks" },
    ...(data.disclosures?.items ?? []).filter((i) => !i.platform).map((i) => ({ at: i.updatedAt, by: i.createdBy, what: `Disclosures, ${i.title}` })),
  ]);
  const lastText = last ? ` · last change${last.by ? ` by ${last.by}` : ""}, ${agoText(last.at)} (${last.what})` : "";

  return (
    <TabFrame>
      <SettingsSectionHeader
        actions={
          <Button type="button" variant="highlight" disabled={!data.disclosures} title={data.disclosures ? undefined : "The disclosures could not be read."} onClick={() => setTrying(true)}>Try a case</Button>
        }
      />
      {failed > 0 ? (
        <StatusLine tone="bad">{failed} of 6 steps could not be read. Nothing was changed; reload the page to try again{lastText}</StatusLine>
      ) : needs.length ? (
        <StatusLine tone="warn">{plural(needs.length, "thing needs", "things need")} you{lastText}</StatusLine>
      ) : (
        <StatusLine>All steps live{lastText}</StatusLine>
      )}

      <TabBody>
        <Pane
          className="lg:flex-1"
          title="The call, step by step"
          sub="Click a step to change it"
          actions={carriers || lines ? <StatusChip dot={false}>{plural(carriers, "carrier")} · {plural(lines, "product")}</StatusChip> : undefined}
        >
          <ol aria-label="The call, in order" className="m-0 flex list-none flex-wrap items-center gap-1.5 border-b border-[var(--border)] px-4 py-3">
            {strip.map((step, i) => {
              const set = Boolean(step.tab || step.href);
              const body = (
                <>
                  <span className={cn("inline-grid size-5 place-items-center rounded-full text-xs font-semibold", set ? "bg-[var(--primary)] text-[var(--on-primary)]" : "bg-[var(--surface-alt)] text-[var(--body)]")}>{step.n}</span>
                  {step.label}
                </>
              );
              const chip = cn("inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-2 text-xs font-medium no-underline", set ? "border-[var(--border-strong)] text-[var(--ink)] hover:bg-[var(--surface-alt)]" : "border-dashed border-[var(--border)] text-[var(--muted)]");
              return (
                <li key={step.label} className="flex items-center gap-1.5">
                  {i > 0 && <span aria-hidden="true" className="h-px w-3 bg-[var(--border-strong)]" />}
                  {step.tab ? (
                    <button type="button" className={chip} onClick={() => onOpen(step.tab!)}>{body}</button>
                  ) : step.href ? (
                    <Link href={step.href} className={chip}>{body}</Link>
                  ) : (
                    <span className={chip}>{body}</span>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="flex flex-col gap-4 p-4">
            {lanes.map((lane) => (
              <section key={lane.title} aria-label={lane.title} className="flex flex-col gap-2">
                <h4 className="m-0 text-xs font-semibold text-[var(--muted)]">{lane.title}</h4>
                <div className="grid gap-2 sm:grid-cols-2 @3xl:grid-cols-4">
                  {lane.tiles.map((tile, i) => (tile ? <StepTile key={tile.title} tile={tile} onOpen={onOpen} /> : <div key={i} aria-hidden="true" />))}
                </div>
              </section>
            ))}
          </div>
        </Pane>

        <Pane className="lg:w-[300px] lg:shrink-0" title="Needs you" actions={<GoldCount value={needs.length} label={`${needs.length} things need you`} />}>
          {needs.length === 0 ? (
            <EmptyState title="Nothing needs you" hint="Every step is live: no drafts waiting, no pair on the Insurvas default." />
          ) : (
            <div className="flex flex-col">
              {needs.map((item) => (
                <SelectRow key={item.key} title={item.title} sub={item.detail} end={<ChevronRight aria-hidden="true" className="size-4" />} onClick={() => onOpen(item.tab, item.anchor ?? null)} />
              ))}
            </div>
          )}
        </Pane>
      </TabBody>

      {trying && data.disclosures && (
        <Sheet title="Try a case" subtitle="Answer as a client would; see which documents the application would carry. Nothing is saved." onClose={() => setTrying(false)} className={WIDE_SHEET}>
          <TryACase docs={docs} library={data.disclosures} onOpen={(item) => { setTrying(false); onOpen("disclosures", `doc.${item.code}`); }} />
        </Sheet>
      )}
    </TabFrame>
  );
}

function StepTile({ tile, onOpen }: { tile: Tile; onOpen: (tab: SalesProcessTab, anchor?: string | null) => void }) {
  const quiet = !tile.tab && !tile.href;
  const inner = (
    <>
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className={cn("inline-grid size-6 shrink-0 place-items-center rounded-[6px] text-xs font-semibold", quiet ? "bg-[var(--surface-alt)] text-[var(--muted)]" : "bg-[var(--primary-soft)] text-[var(--accent-ink)]")}>{tile.step}</span>
        <b className="text-sm font-semibold text-[var(--ink)]">{tile.title}</b>
      </span>
      {tile.used && <span className="text-xs text-[var(--muted)]">{tile.used}</span>}
      <span className="text-xs leading-[1.5] text-[var(--body)]">{tile.what}</span>
      {tile.facts && <span className="text-xs leading-[1.5] text-[var(--ink)]">{tile.facts}</span>}
      {tile.go && <span className="mt-auto flex items-center justify-between pt-1 text-xs font-semibold text-[var(--accent-ink)]">{tile.go}<ChevronRight aria-hidden="true" className="size-3.5" /></span>}
    </>
  );
  const frame = cn("flex min-h-[132px] flex-col gap-1 rounded-[10px] border p-3 text-left no-underline", quiet ? "border-dashed border-[var(--border)] opacity-80" : "border-[var(--border)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]");
  if (tile.tab) return <button type="button" className={frame} onClick={() => onOpen(tile.tab!)}>{inner}</button>;
  if (tile.href) return <Link href={tile.href} className={frame}>{inner}</Link>;
  return <div className={frame}>{inner}</div>;
}
