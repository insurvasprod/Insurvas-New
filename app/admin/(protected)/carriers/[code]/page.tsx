import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CarrierFactReports } from "@/components/admin/carrier-fact-reports";
import { CarrierGuidanceEditor } from "@/components/admin/carrier-guidance-editor";
import { CarrierRecordActions } from "@/components/admin/catalog/carrier-record-actions";
import { CarrierRecordIdentity } from "@/components/admin/catalog/carrier-record-identity";
import { CarrierSetupDot } from "@/components/admin/catalog/carrier-setup-dot";
import { CatalogPage } from "@/components/admin/catalog/catalog-page";
import { ServicingFourRows } from "@/components/admin/servicing-guide-editor";
import { CarrierRulesWorkspace } from "@/components/app/carrier-rules-workspace";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FactTable } from "@/components/ui/fact-table";
import { EmptyState, ErrorState } from "@/components/ui/page-states";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { readCarrierUsage } from "@/lib/carriers/adminService";
import { listFactReportQueue } from "@/lib/carriers/factReports";
import { countCarrierPolicies, getPlatformCarrierByCode, readCarrierFacets, readCarrierHistory, readSetupInputs } from "@/lib/carriers/record";
import { carrierHref, carrierSetup, FACET_INFO, FACETS, isRecordTab, RECORD_TAB_LABEL, RECORD_TABS, type RecordTab } from "@/lib/carriers/setup";
import type { CarrierUsageSnapshot } from "@/lib/carriers/usage";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { loadGuidance } from "@/lib/ingestion/bookImport";
import { CARRIER_RULES_PENDING_MESSAGE, loadCarrierRules } from "@/lib/ingestion/carrierRulesStore";
import { FILE_TYPE_LABELS, type CarrierFileType } from "@/lib/ingestion/constants";
import { loadGuides, SERVICING_PENDING_MESSAGE } from "@/lib/retention/servicingStore";
import { recordDate, recordDateTime } from "@/lib/tenants/recordFormat";

type GuidanceRow = Parameters<typeof CarrierGuidanceEditor>[0]["rows"][number];
type Params = { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const count = (n: number) => n.toLocaleString("en-US");
const fileLabel = (type: string) => FILE_TYPE_LABELS[type as CarrierFileType] ?? type;
const FIELD_MAP_TONE: Record<string, StatusTone> = { published: "good", needs_review: "warning", in_review: "info", draft: "neutral", retired: "neutral" };
const FIELD_MAP_LABEL: Record<string, string> = { published: "Published", needs_review: "Needs review", in_review: "In review", draft: "Draft", retired: "Retired" };

/** "Open in Layout maps, filtered to Americo" and the like: the cross-carrier page, on this carrier. */
function OpenAll({ href, label }: { href: string; label: string }) {
  return <Link href={href} className="text-sm font-medium text-foreground underline underline-offset-2 hover:text-[var(--accent-ink)]">{label}</Link>;
}

function Unread({ what, retry }: { what: string; retry: string }) {
  return <ErrorState title={`Couldn't load this carrier's ${what}`} detail="The other tabs still work. Try again; if it keeps failing, the error is in the server log." action={<Link href={retry} className="text-sm font-medium underline underline-offset-2">Try again</Link>} />;
}

/**
 * The carrier record (admin round 1, docs/design/admin-r1/catalog.html screen 8, new page): everything about one
 * platform carrier, as tabs in the URL (`?tab=`). Overview (identity, the three portal facts — editable here, audited
 * — the set-up summary and who uses it) · Rules · Files & layouts · Status words · Field maps · Portal guide ·
 * Servicing · Fact reports · History. Each tab is the same editor the cross-carrier page uses, on this carrier; files,
 * status words and field maps are shown here and edited on their own pages, opened filtered to this carrier.
 */
export default async function CarrierRecordPage({ params, searchParams }: Params) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "carriers")) redirect("/admin");

  const [{ code: rawCode }, query] = await Promise.all([params, searchParams]);
  const code = decodeURIComponent(rawCode);
  const carrier = await getPlatformCarrierByCode(code);
  if (!carrier) notFound();
  const tab: RecordTab = typeof query.tab === "string" && isRecordTab(query.tab) ? query.tab : "overview";
  const here = (t: RecordTab) => carrierHref(carrier.code, t);

  const [inputs, usage] = await Promise.all([
    readSetupInputs(admin.id),
    readCarrierUsage().catch((): CarrierUsageSnapshot => ({ available: false })),
  ]);
  const setup = carrierSetup(carrier.id, inputs);
  const used = usage.available ? usage.byCarrier[carrier.id] ?? null : undefined;

  const tabs = (
    <ViewTabs
      label={`${carrier.name} sections`}
      value={tab}
      tabs={RECORD_TABS.map((key) => {
        const facet = FACETS.find((f) => FACET_INFO[f].tab === key && f !== "facts");
        const waiting = facet ? setup[facet].count : undefined;
        return { key, label: RECORD_TAB_LABEL[key], href: here(key), count: waiting ? waiting : null };
      })}
    />
  );

  return (
    <CatalogPage
      step="carriers"
      title={carrier.name}
      breadcrumbs={[{ label: "Catalog", href: "/admin/catalog" }, { label: "Carriers", href: "/admin/carriers" }, { label: carrier.name }]}
      info="Everything about one carrier. Each tab is the same editor the cross-carrier page uses, on this carrier."
      tabs={tabs}
      actions={<CarrierRecordActions carrier={carrier} canOverride={admin.role === "super_admin"} />}
    >
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        {tab === "overview" && <Overview carrier={carrier} setup={setup} used={used} here={here} />}
        {tab === "rules" && <RulesTab carrierId={carrier.id} adminId={admin.id} />}
        {tab !== "overview" && tab !== "rules" && tab !== "guide" && tab !== "servicing" && tab !== "reports" && tab !== "history" && <FacetsTab tab={tab} carrierId={carrier.id} code={carrier.code} name={carrier.name} retry={here(tab)} />}
        {tab === "guide" && <GuideTab carrierId={carrier.id} active={carrier.is_active} />}
        {tab === "servicing" && <ServicingTab carrierId={carrier.id} active={carrier.is_active} />}
        {tab === "reports" && <ReportsTab carrierId={carrier.id} code={carrier.code} />}
        {tab === "history" && <HistoryTab carrierId={carrier.id} retry={here("history")} />}
      </div>
    </CatalogPage>
  );
}

async function Overview({ carrier, setup, used, here }: {
  carrier: NonNullable<Awaited<ReturnType<typeof getPlatformCarrierByCode>>>;
  setup: ReturnType<typeof carrierSetup>;
  used: { tenants: number; contractTenants: number; openAppointments: number; appointments: number } | null | undefined;
  here: (tab: RecordTab) => string;
}) {
  const policies = await countCarrierPolicies(carrier.id);
  const unknown = "Could not be read";
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
      <Card className="min-w-0">
        <CardHeader><CardTitle>Identity and how we find them</CardTitle></CardHeader>
        <CardContent className="pb-4">
          <CarrierRecordIdentity carrier={carrier} />
        </CardContent>
      </Card>
      <div className="flex min-w-0 flex-col gap-4">
        <TableCard title="Set up">
          <Table>
            <TableBody>
              {FACETS.map((key) => (
                <TableRow key={key}>
                  <TableCell className="font-medium text-foreground"><Link href={here(FACET_INFO[key].tab)} className="hover:underline">{FACET_INFO[key].label}</Link></TableCell>
                  <TableCell className="max-w-[14rem] truncate text-muted-foreground" title={setup[key].detail}>{setup[key].detail}</TableCell>
                  <TableCell className="w-10 text-center"><CarrierSetupDot cell={setup[key]} label={FACET_INFO[key].label} href={here(FACET_INFO[key].tab)} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
        <TableCard title="Used by" bodyClassName="px-4">
          <FactTable
            rows={[
              ["Agencies", used === undefined ? unknown : count(used?.tenants ?? 0)],
              ["With an active contract", used === undefined ? unknown : count(used?.contractTenants ?? 0)],
              ["Appointments", used === undefined ? unknown : `${count(used?.appointments ?? 0)} recorded · ${count(used?.openAppointments ?? 0)} open`],
              ["Policies on the books", policies === null ? unknown : count(policies)],
              ["Created", recordDate(carrier.created_at)],
            ]}
          />
        </TableCard>
      </div>
    </div>
  );
}

async function RulesTab({ carrierId, adminId }: { carrierId: string; adminId: string }) {
  const view = await loadCarrierRules({ plane: "platform", adminId }).catch(() => null);
  if (!view) return <Unread what="rules" retry="?tab=rules" />;
  if (!view.available) return <EmptyState title="Needs a database update" hint={CARRIER_RULES_PENDING_MESSAGE} />;
  const row = view.carriers.find((c) => c.carrierId === carrierId);
  if (!row) return <EmptyState title="Rules are kept for active carriers" hint="Reactivate the carrier to set its save windows and settings." />;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <CarrierRulesWorkspace carriers={[row]} plane="platform" endpoint="/api/admin/carrier-rules" readOnly={false} asOf={view.asOf} editor="sheet" hideToolbar />
      <p className="m-0 text-xs text-muted-foreground">Edit opens the same editor as <OpenAll href="/admin/carrier-rules" label="Carrier rules" />.</p>
    </div>
  );
}

async function FacetsTab({ tab, carrierId, code, name, retry }: { tab: RecordTab; carrierId: string; code: string; name: string; retry: string }) {
  const facets = await readCarrierFacets(carrierId);
  const filtered = (path: string) => `${path}?carrier=${encodeURIComponent(code)}`;

  if (tab === "files") {
    if (!facets.layouts) return <Unread what="layouts" retry={retry} />;
    return (
      <TableCard title="Files & layouts" description="Which layout reads each kind of file this carrier sends. Change it on Layout maps." action={<OpenAll href={filtered("/admin/layout-maps")} label={`Open in Layout maps, filtered to ${name}`} />}>
        {facets.layouts.length === 0 ? (
          <EmptyState title="No layout assigned" hint="A carrier's files are read once a live layout is assigned to it for each kind of file." />
        ) : (
          <Table className="min-w-[640px]">
            <TableHeader><TableRow><TableHead>File</TableHead><TableHead>Layout</TableHead><TableHead className="w-[110px]">Live</TableHead><TableHead className="w-[130px]">Open draft</TableHead></TableRow></TableHeader>
            <TableBody>
              {facets.layouts.map((l) => (
                <TableRow key={`${l.fileType}-${l.layoutKey}`}>
                  <TableCell className="font-medium text-foreground">{fileLabel(l.fileType)}</TableCell>
                  <TableCell><Link href={`/admin/layout-maps/${encodeURIComponent(l.layoutKey)}`} className="hover:underline">{l.layoutName ?? l.layoutKey}</Link> <code className="font-mono text-xs text-muted-foreground">{l.layoutKey}</code></TableCell>
                  <TableCell>{l.liveVersion !== null ? <StatusChip tone="good">v{l.liveVersion}</StatusChip> : <StatusChip tone="warning">None live</StatusChip>}</TableCell>
                  <TableCell className="tabular-nums">{l.openVersion !== null ? `v${l.openVersion}` : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableCard>
    );
  }

  if (tab === "status") {
    if (!facets.waitingWords) return <Unread what="status words" retry={retry} />;
    return (
      <TableCard
        title="Status words"
        description={facets.mappedWords === null ? "Words in this carrier's files that wait for a meaning." : `${count(facets.mappedWords)} ${facets.mappedWords === 1 ? "word is" : "words are"} mapped. These wait for a meaning; map them on Status maps.`}
        action={<OpenAll href={filtered("/admin/status-maps")} label={`Open in Status maps, filtered to ${name}`} />}
      >
        {facets.waitingWords.length === 0 ? (
          <EmptyState title="No words waiting" hint="New status words from this carrier's files appear here before any row is held for long." />
        ) : (
          <Table className="min-w-[640px]">
            <TableHeader><TableRow><TableHead>Carrier&apos;s word</TableHead><TableHead className="w-[130px]">File</TableHead><TableHead className="w-[110px] text-right">Rows held</TableHead><TableHead className="w-[100px] text-right">Agencies</TableHead><TableHead className="w-[130px]">First seen</TableHead></TableRow></TableHeader>
            <TableBody>
              {facets.waitingWords.map((w) => (
                <TableRow key={`${w.fileType}-${w.raw}`}>
                  <TableCell className="font-mono text-sm text-foreground">{w.raw || "(blank)"}</TableCell>
                  <TableCell>{fileLabel(w.fileType)}</TableCell>
                  <TableCell className="text-right tabular-nums">{count(w.rows)}</TableCell>
                  <TableCell className="text-right tabular-nums">{count(w.agencies)}</TableCell>
                  <TableCell className="whitespace-nowrap" title={w.firstSeenAt ? recordDateTime(w.firstSeenAt) : undefined}>{w.firstSeenAt ? recordDate(w.firstSeenAt) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableCard>
    );
  }

  if (!facets.fieldMaps) return <Unread what="field maps" retry={retry} />;
  return (
    <TableCard title="Field maps" description="How the Insurvas extension fills this carrier's application forms, per product. Review them on Field maps." action={<OpenAll href={filtered("/admin/field-maps")} label={`Open in Field maps, filtered to ${name}`} />}>
      {facets.fieldMaps.length === 0 ? (
        <EmptyState title="No field map" hint="A field map is drawn from the carrier's portal and reviewed before it fills forms for agencies." />
      ) : (
        <Table className="min-w-[600px]">
          <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="w-[90px]">Version</TableHead><TableHead className="w-[140px]">Status</TableHead><TableHead className="w-[130px]">Updated</TableHead></TableRow></TableHeader>
          <TableBody>
            {facets.fieldMaps.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-medium text-foreground">{m.productLabel}</TableCell>
                <TableCell className="tabular-nums">v{m.version}</TableCell>
                <TableCell><StatusChip tone={FIELD_MAP_TONE[m.status] ?? "neutral"}>{FIELD_MAP_LABEL[m.status] ?? m.status}</StatusChip></TableCell>
                <TableCell className="whitespace-nowrap">{m.updatedAt ? recordDate(m.updatedAt) : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </TableCard>
  );
}

async function GuideTab({ carrierId, active }: { carrierId: string; active: boolean }) {
  const view = await loadGuidance().catch(() => null);
  if (!view) return <Unread what="portal guidance" retry="?tab=guide" />;
  if (!view.available) return <EmptyState title="Needs a database update" hint="Portal guidance needs the book-import database update (20261008190000)." />;
  const row = (view.carriers as GuidanceRow[]).find((c) => c.carrierId === carrierId);
  if (!row) return <EmptyState title={active ? "This carrier is not in the guidance list" : "Guidance is kept for active carriers"} hint="Reactivate the carrier to write where its policy file lives in its portal." />;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <CarrierGuidanceEditor rows={[row]} single />
      <p className="m-0 text-xs text-muted-foreground">The same row as on <OpenAll href="/admin/carrier-guidance" label="Portal guidance" />. Agencies see it on the import screen the moment it is saved.</p>
    </div>
  );
}

async function ServicingTab({ carrierId, active }: { carrierId: string; active: boolean }) {
  const view = await loadGuides().catch(() => null);
  if (!view) return <Unread what="servicing instructions" retry="?tab=servicing" />;
  if (!view.available) return <EmptyState title="Needs a database update" hint={SERVICING_PENDING_MESSAGE} />;
  const row = view.carriers.find((c) => c.carrierId === carrierId);
  if (!row) return <EmptyState title={active ? "This carrier is not in the servicing list" : "Servicing instructions are kept for active carriers"} hint="Reactivate the carrier to write how it takes each servicing change." />;
  return (
    <Card className="min-w-0">
      <CardHeader><CardTitle>Servicing instructions</CardTitle></CardHeader>
      <CardContent className="pb-4">
        <ServicingFourRows row={row} />
      </CardContent>
    </Card>
  );
}

async function ReportsTab({ carrierId, code }: { carrierId: string; code: string }) {
  const loaded = await listFactReportQueue().catch(() => null);
  if (!loaded) return <Unread what="fact reports" retry="?tab=reports" />;
  if (!loaded.available) return <EmptyState title="Needs a database update" hint="Carrier fact reports need a database update (20261027200000) that has not been applied yet." />;
  return <CarrierFactReports mode="carrier" reports={loaded.reports.filter((r) => r.carrierId === carrierId)} carrierCodes={{ [carrierId]: code }} nowIso={new Date().toISOString()} />;
}

async function HistoryTab({ carrierId, retry }: { carrierId: string; retry: string }) {
  const history = await readCarrierHistory(carrierId);
  if (!history) return <Unread what="history" retry={retry} />;
  return (
    <TableCard title="History" description="From the audit log, every part of this carrier together, newest first: the latest 100." action={<OpenAll href={`/admin/audit-log?target=${carrierId}`} label="Open the audit log" />}>
      {history.length === 0 ? (
        <EmptyState title="Nothing recorded yet" hint="Edits to the carrier, its rules, guidance, servicing instructions and fact reports are listed here." />
      ) : (
        <Table className="min-w-[860px]">
          <TableHeader><TableRow><TableHead className="w-[150px]">When</TableHead><TableHead>What</TableHead><TableHead>Detail</TableHead><TableHead className="w-[150px]">By</TableHead></TableRow></TableHeader>
          <TableBody>
            {history.map((h) => (
              <TableRow key={h.id}>
                <TableCell className="whitespace-nowrap tabular-nums" title={recordDateTime(h.at)}>{recordDate(h.at)}</TableCell>
                <TableCell className="max-w-[20rem] truncate text-foreground" title={h.label}>{h.label}</TableCell>
                <TableCell className="max-w-[24rem] truncate text-muted-foreground" title={[h.detail, h.reason ? `Reason: ${h.reason}` : null].filter(Boolean).join(" · ") || undefined}>{[h.detail, h.reason ? `Reason: ${h.reason}` : null].filter(Boolean).join(" · ") || "—"}</TableCell>
                <TableCell className="max-w-[10rem] truncate">{h.actor}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </TableCard>
  );
}
