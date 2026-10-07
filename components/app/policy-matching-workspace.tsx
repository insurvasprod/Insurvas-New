"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ViewTabs } from "@/components/app/book-of-business-views";
import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { fileDay } from "@/lib/ingestion/constants";
import { MATCH_FIELD_LABELS, MATCH_FIELDS, type FieldOutcome } from "@/lib/ingestion/policyMatching";
import type { LinkRow, MappedAgent, ReviewRow, UnmappedAgent } from "@/lib/ingestion/policyMatchingStore";
import { notify } from "@/lib/notify";

type Tab = "review" | "links" | "agents";
const METHOD_LABEL: Record<string, string> = { submission_record: "Submission record", policy_number_exact: "Issued policy number", human: "A person", ai_review: "AI review", import: "Import", no_match: "New client from the file", identity_exact: "Same name and date of birth" };
const TYPE_LABEL: Record<string, string> = { deal_flow: "Deal", application: "Application", contact: "Client", provisional: "No client found" };
const OUTCOME_CLASS: Record<FieldOutcome, string> = { match: "text-[var(--success-ink)]", partial: "text-[var(--warning-ink)]", mismatch: "text-[var(--error-ink)]", missing: "text-muted-foreground" };
const OUTCOME_WORD: Record<FieldOutcome, string> = { match: "same", partial: "partly", mismatch: "different", missing: "—" };
const dollars = (cents: number | null | undefined) => (cents === null || cents === undefined ? "—" : `$${(cents / 100).toFixed(2)}`);
const nameOf = (p: { firstName?: string | null; lastName?: string | null }) => [p.firstName, p.lastName].filter(Boolean).join(" ") || "—";

/**
 * LA-4.8 (Notion sprint) · policies to link, the links made, and agent codes to map. A person picks
 * the client for a policy whose number we don't hold; the AI does it once a provider is configured.
 */
export function PolicyMatchingWorkspace({ reviews, links, unmapped, mapped, members, readOnly, aiNote }: { reviews: ReviewRow[]; links: LinkRow[]; unmapped: UnmappedAgent[]; mapped: MappedAgent[]; members: Array<{ userId: string; name: string; role: string }>; readOnly: boolean; aiNote: string }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [tab, setTab] = useState<Tab>("review");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [assign, setAssign] = useState<Record<string, string>>({});
  const open = reviews.find((review) => review.id === openId) ?? null;
  const q = query.trim().toLowerCase();
  const has = (...values: Array<string | null | undefined>) => !q || values.some((value) => (value ?? "").toLowerCase().includes(q));
  const visibleReviews = useMemo(() => reviews.filter((r) => has(r.policyNumber, r.carrierName, nameOf(r.carrierRow ?? {}))), [reviews, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const visibleLinks = useMemo(() => links.filter((l) => has(l.policyNumber, l.carrierName, l.clientName)), [links, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const visibleAgents = useMemo(() => unmapped.filter((a) => has(a.agentIdentifier, a.carrierName)), [unmapped, q]); // eslint-disable-line react-hooks/exhaustive-deps

  async function post(key: string, body: Record<string, unknown>, done: string) {
    setBusy(key);
    try {
      const response = await fetch("/api/app/policy-matching", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "That did not save.");
      notify.done(done);
      setOpenId(null);
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  }

  const toolbar = (
    <DataToolbar actions={<>
      {q && <ClearFiltersButton onClick={() => setQuery("")} />}
      <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
    </>}>
      <ToolbarSearch value={query} onChange={setQuery} placeholder={tab === "agents" ? "Search agent codes" : "Search policies or clients"} />
    </DataToolbar>
  );

  return (
    <>
      <ViewTabs<Tab>
        label="Policy matching views"
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "review", label: "To review", count: reviews.length },
          { key: "links", label: "Links", count: links.length },
          { key: "agents", label: "Agent codes", count: unmapped.length },
        ]}
      />

      {tab === "review" && (
        <TableCard toolbar={toolbar}>
          {reviews.length === 0 ? <EmptyState title="Nothing to review" hint="Policies whose number we don't hold appear here with the closest clients." />
            : visibleReviews.length === 0 ? <NoMatches noun="policies" onClear={() => setQuery("")} />
            : (
              <table className="portal-lead-table w-full min-w-[900px] text-left text-sm">
                <thead><tr><th>Policy</th><th>Carrier</th><th>Insured (carrier)</th><th>File date</th><th className="w-[140px]">Best candidate</th><th className="w-[90px] text-right">Score</th><th className="w-[90px] text-right"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {visibleReviews.map((review) => {
                    const best = review.shortlist[0];
                    return (
                      <tr key={review.id}>
                        <td className="font-mono text-xs text-foreground">{review.policyNumber}</td>
                        <td>{review.carrierName}</td>
                        <td>{nameOf(review.carrierRow ?? {})}</td>
                        <td className="tabular-nums">{review.carrierRow?.fileDate ? fileDay(review.carrierRow.fileDate) : "—"}</td>
                        <td>{best ? nameOf(best) : <span className="text-muted-foreground">No candidate</span>}</td>
                        <td className={`text-right tabular-nums ${best?.likely ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{best ? best.score : "—"}</td>
                        <td className="text-right"><Button type="button" variant="outline" size="sm" onClick={() => setOpenId(review.id)}>{readOnly ? "Open" : "Review"}</Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
        </TableCard>
      )}

      {tab === "links" && (
        <TableCard toolbar={toolbar}>
          {links.length === 0 ? <EmptyState title="No policy is linked yet" hint="Links appear as carrier files arrive: by policy number when we hold it, otherwise once a person decides." />
            : visibleLinks.length === 0 ? <NoMatches noun="links" onClear={() => setQuery("")} />
            : (
              <table className="portal-lead-table w-full min-w-[900px] text-left text-sm">
                <thead><tr><th>Policy</th><th>Carrier</th><th>Linked to</th><th>How</th><th className="w-[120px]">When</th><th className="w-[100px] text-right"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {visibleLinks.map((link) => (
                    <tr key={link.id}>
                      <td className="font-mono text-xs text-foreground">{link.policyNumber}</td>
                      <td>{link.carrierName}</td>
                      <td>{link.clientName ?? TYPE_LABEL[link.type] ?? link.type}</td>
                      <td>{METHOD_LABEL[link.method] ?? link.method}{link.confidence !== null ? ` · ${link.confidence}%` : ""}</td>
                      <td className="tabular-nums">{fileDay(link.createdAt.slice(0, 10))}</td>
                      <td className="text-right">{!readOnly && <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void post(`reopen-${link.id}`, { action: "reopen", match_id: link.id }, "Back in the review queue.")}>Reopen</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </TableCard>
      )}

      {tab === "agents" && (
        <TableCard toolbar={toolbar}>
          {unmapped.length === 0 && mapped.length === 0 ? <EmptyState title="No agent codes yet" hint="Each carrier's writing-agent code appears here the first time a file carries it." />
            : (
              <table className="portal-lead-table w-full min-w-[820px] text-left text-sm">
                <thead><tr><th>Carrier&apos;s agent code</th><th>Carrier</th><th className="w-[90px] text-right">Policies</th><th className="w-[260px]">Agent</th><th className="w-[100px] text-right"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {visibleAgents.map((agent) => {
                    const key = `${agent.carrierId}|${agent.agentIdentifier}`;
                    return (
                      <tr key={key}>
                        <td className="font-mono text-xs text-foreground">{agent.agentIdentifier}</td>
                        <td>{agent.carrierName}</td>
                        <td className="text-right tabular-nums">{agent.policies.toLocaleString("en-US")}</td>
                        <td>
                          <select aria-label={`Agent for ${agent.agentIdentifier}`} className={`${toolbarControl} w-full`} disabled={readOnly} value={assign[key] ?? ""} onChange={(e) => setAssign((current) => ({ ...current, [key]: e.target.value }))}>
                            <option value="">Not mapped</option>
                            {members.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}
                          </select>
                        </td>
                        <td className="text-right">{!readOnly && <Button type="button" size="sm" disabled={!assign[key] || busy !== null} onClick={() => void post(`map-${key}`, { action: "map_agent", carrier_id: agent.carrierId, agent_identifier: agent.agentIdentifier, user_id: assign[key] }, "Agent code mapped.")}>Map</Button>}</td>
                      </tr>
                    );
                  })}
                  {mapped.filter((m) => has(m.agentIdentifier, m.carrierName, m.userName)).map((m) => (
                    <tr key={m.id}>
                      <td className="font-mono text-xs text-foreground">{m.agentIdentifier}</td>
                      <td>{m.carrierName}</td>
                      <td className="text-right text-muted-foreground">—</td>
                      <td>{m.userName}<span className="block text-xs text-muted-foreground">Mapped</span></td>
                      <td className="text-right">{!readOnly && <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void post(`unmap-${m.id}`, { action: "unmap_agent", map_id: m.id }, "Mapping removed.")}>Unmap</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </TableCard>
      )}

      <Dialog open={Boolean(open)} onOpenChange={(next) => { if (!next && !busy) setOpenId(null); }}>
        <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-w-4xl">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">{open.carrierName} · {open.policyNumber}</DialogTitle>
                <DialogDescription>{aiNote} No single field decides: a matching name alone is not enough.</DialogDescription>
              </DialogHeader>
              <div className="overflow-x-auto">
                <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
                  <thead><tr><th>Field</th><th>Carrier file</th>{open.shortlist.map((c, i) => <th key={c.id}>{i + 1}. {c.type === "deal_flow" ? "Deal" : "Application"} · {c.date}</th>)}</tr></thead>
                  <tbody>
                    <tr><td>Name</td><td>{nameOf(open.carrierRow ?? {})}</td>{open.shortlist.map((c) => <td key={c.id}><span className={OUTCOME_CLASS[c.fields.surname]}>{nameOf(c)}</span></td>)}</tr>
                    <tr><td>Date of birth</td><td>{open.carrierRow?.dob ?? "—"}</td>{open.shortlist.map((c) => <td key={c.id} className={OUTCOME_CLASS[c.fields.dob]}>{c.dob ?? "—"}</td>)}</tr>
                    <tr><td>Phone</td><td>{open.carrierRow?.phone ?? "—"}</td>{open.shortlist.map((c) => <td key={c.id} className={OUTCOME_CLASS[c.fields.phone]}>{c.phone ?? "—"}</td>)}</tr>
                    <tr><td>Monthly premium</td><td>{dollars(open.carrierRow?.premiumCents)}</td>{open.shortlist.map((c) => <td key={c.id} className={OUTCOME_CLASS[c.fields.premium]}>{dollars(c.premiumCents)}</td>)}</tr>
                    <tr><td>Face amount</td><td>{dollars(open.carrierRow?.faceCents)}</td>{open.shortlist.map((c) => <td key={c.id} className={OUTCOME_CLASS[c.fields.face]}>{dollars(c.faceCents)}</td>)}</tr>
                    <tr><td>Fields</td><td /> {open.shortlist.map((c) => <td key={c.id} className="text-xs">{MATCH_FIELDS.map((f) => `${MATCH_FIELD_LABELS[f]} ${OUTCOME_WORD[c.fields[f]]}`).join(" · ")}</td>)}</tr>
                    <tr><td className="font-semibold">Score</td><td />{open.shortlist.map((c) => <td key={c.id} className="font-semibold tabular-nums">{c.score}{c.likely ? " · likely" : ""}</td>)}</tr>
                    {!readOnly && <tr><td /><td />{open.shortlist.map((c, i) => <td key={c.id}><Button type="button" size="sm" disabled={busy !== null} onClick={() => void post(`pick-${c.id}`, { action: "resolve", review_id: open.id, candidate: i }, "Policy linked.")}>This client</Button></td>)}</tr>}
                  </tbody>
                </table>
              </div>
              {open.shortlist.length === 0 && <p className="m-0 text-sm text-muted-foreground">No deal or application for this carrier in the 14 days before the file looks like this policy.</p>}
              <DialogFooter>
                <Button type="button" variant="outline" disabled={busy !== null} onClick={() => setOpenId(null)}>Close</Button>
                {!readOnly && <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void post(`none-${open.id}`, { action: "resolve", review_id: open.id, candidate: null }, "Recorded: no client found.")}>None of these</Button>}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
