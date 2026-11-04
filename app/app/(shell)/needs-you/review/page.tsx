import { DataInPage } from "@/components/app/data-in/data-in-page";
import { ReviewWorkspace, type ReviewItem } from "@/components/app/book/needs-you/review-workspace";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { DISCREPANCY_LABELS, type DiscrepancyType } from "@/lib/ingestion/discrepancyEngine";
import { isRecordUuid } from "@/lib/ingestion/path";
import { fileHref } from "@/lib/ingestion/trace";
import { fromFile, isNeedsYouKind, KIND_META, searchParam, searchText, viewItems, waitsOnInsurvas, type NeedsYouKind } from "@/lib/needsYou/kinds";
import { needsYouScope } from "@/lib/needsYou/scope";
import { loadFileFilter, loadNeedsYou } from "@/lib/needsYou/store";

type Search = { kind?: string; file?: string; carrier?: string; date?: string; type?: string; id?: string; from?: string; q?: string };

/** What the Review page is about, in its title: one kind's label, or "Review" for a mix. */
const TITLES: Partial<Record<NeedsYouKind, string>> = { "no-sale": "No sale yet", "pick-client": "Pick the client" };

/**
 * Book of business › Needs you › Review (round 5, owner 2026-11-03: "do that as a new page … all of the work
 * that we need to do in that page is going to be to decide"). The one place decisions are made: the queue on the
 * left (search, tick for bulk), one question on the right with its answers as numbered buttons; an answer saves
 * through the kind's own API and the next item opens. Opened from a file ("Review 407"), a Files row, a Needs you
 * line, Pay issues and the bell, each narrowing the queue by `file`, `kind`, `carrier` and (money) `type`; `id`
 * opens at that item. The item page (/needs-you/[kind]/[id]) stays the address an item is shared by.
 */
export default async function NeedsYouReviewPage({ searchParams }: { searchParams: Promise<Search> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Needs you" description="Every decision your carrier files leave for a person." />;
  if (!actAsPagePermission(guard, "policies.view")) return <RoleGateNotice featureLabel="Needs you" detail="Decisions on your book are made by producers, bookkeepers and the account owner." />;
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Needs you" detail="In an agency, the owner, admins and the bookkeeper make these decisions." />;

  const search = await searchParams;
  const scope = await needsYouScope(guard);
  const fileId = search.file && isRecordUuid(search.file) ? search.file : null;
  const [list, file] = await Promise.all([loadNeedsYou(scope), fileId ? loadFileFilter(scope.tenantId, fileId) : null]);
  const kind = search.kind && isNeedsYouKind(search.kind) ? search.kind : null;
  const typeLabel = search.type ? DISCREPANCY_LABELS[search.type as DiscrepancyType]?.label ?? null : null;
  const me = { userId: scope.userId, keeper: scope.keeper };
  // Status words wait on Insurvas: nothing to decide, so they never join a queue.
  const all = viewItems(list.open, scope.keeper ? "agency" : "mine", me).filter((item) => !waitsOnInsurvas(item));
  const queue = all.filter((item) => (!kind || item.kind === kind)
    && (!file || fromFile(item, file))
    && (!search.carrier || item.ref?.carrierId === search.carrier)
    && (!search.date || item.ref?.fileDate === search.date)
    && (!typeLabel || item.why.startsWith(typeLabel)));

  // `search`: what the queue's search box finds an item by — the list's own rule (policy, client, agent code, file).
  const items: ReviewItem[] = queue.map((item) => ({ kind: item.kind, id: item.id, about: item.about, why: item.why, who: item.who, ageDays: item.ageDays, href: item.href, search: searchText(item) }));
  const startAt = search.id ? Math.max(0, items.findIndex((item) => item.id === search.id)) : 0;
  const backHref = search.from && search.from.startsWith("/app/") ? search.from : file ? fileHref(file.fileId) : "/app/needs-you";
  const title = kind ? TITLES[kind] ?? KIND_META[kind].label : "Review";
  const source = [file?.name, typeLabel].filter(Boolean).join(" · ");

  return (
    <DataInPage step="needs-you" title={title}>
      <ReviewWorkspace
        key={`${kind ?? ""}:${fileId ?? ""}:${search.carrier ?? ""}:${search.date ?? ""}:${search.type ?? ""}`}
        items={items}
        startAt={startAt}
        source={source}
        backHref={backHref}
        readOnly={guard.entitlement.access === "read_only"}
        initialQuery={searchParam(search.q) ?? ""}
      />
    </DataInPage>
  );
}
