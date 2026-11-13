"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { checkboxControl, control, Field, Switch } from "@/components/ui/field";
import { notify } from "@/lib/notify";
import { centsFromInput, dollars, type LeadPostBoard } from "@/lib/leadPost/board";
import type { TestResult } from "@/lib/leadPost/boardStore";
import type { PostActivity } from "@/lib/leadPost/types";
import { cn } from "@/lib/utils";
import { GuideDoc } from "./guide-doc";
import { copyInstructions, copyInstructionsLink, downloadInstructions, emailInstructions } from "./instructions";
import { KeyBox } from "./key-dialogs";
import { ChoiceCard, NeedsUpdate, send } from "./shared";
import { DEFAULT_TEST_LEAD, describeLead, payloadFor, TestLeadDialog, TestResultCard, type TestLead } from "./test-runner";

/**
 * "Connect a vendor" (board A3–A6), four steps in one dialog:
 *   1 Vendor & campaign  a lead source, or a new name; the campaign their leads go to (campaigns whose
 *                        product has no intake form are shown but cannot be picked)
 *   2 Key                shown once, copied, confirmed
 *   3 Send instructions  the vendor's page: email, PDF, copy
 *   4 Test post          one from here, or wait for theirs; then go live
 * With 20261112100100 the key starts in test mode and nothing is live until "Go live"; before it, the
 * key works from step 2 and the last step says so.
 */

type Step = 1 | 2 | 3 | 4;
type Minted = { key: string; record: { id: string; vendorName: string; vendorId: string; fieldMap: Record<string, string>; campaignId: string | null }; settingsSaved?: boolean };
const STEPS = ["Vendor & campaign", "Key", "Send instructions", "Test post"];

export function ConnectWizard({ board, origin, presetVendorId, onClose, onConnected }: { board: LeadPostBoard; origin: string; presetVendorId?: string; onClose: () => void; onConnected: (keyId: string) => Promise<void> }) {
  const [step, setStep] = useState<Step>(1);
  const preset = board.allVendors.find((vendor) => vendor.id === presetVendorId);
  const [vendorText, setVendorText] = useState(preset?.name ?? "");
  const [price, setPrice] = useState("");
  const [campaignId, setCampaignId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<Minted | null>(null);
  const [copied, setCopied] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [copyTo, setCopyTo] = useState("");
  const [mode, setMode] = useState<"send" | "wait">("send");
  const [lead, setLead] = useState<TestLead>(DEFAULT_TEST_LEAD);
  const [editingLead, setEditingLead] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [theirs, setTheirs] = useState<PostActivity["recent"][number] | null>(null);
  const listeningSince = useRef<string>("");

  const r8 = board.r8Ready;
  const vendor = board.allVendors.find((item) => item.name.trim().toLowerCase() === vendorText.trim().toLowerCase()) ?? null;
  const isNew = vendorText.trim().length > 0 && !vendor;
  const campaigns = useMemo(() => (vendor ? board.campaigns.filter((campaign) => campaign.vendorId === vendor.id) : []), [board.campaigns, vendor]);
  const priceCents = centsFromInput(price);
  const picked = campaigns.find((campaign) => campaign.id === campaignId) ?? null;
  const canNext1 = Boolean(vendorText.trim()) && !vendor?.connected && !(priceCents !== null && Number.isNaN(priceCents)) && (!campaignId || Boolean(picked?.intakeForm));
  const postingUrl = `${origin}${board.postingPath}`;
  const vendorName = minted?.record.vendorName ?? vendor?.name ?? vendorText.trim();
  const campaignName = picked?.name ?? (campaigns.find((campaign) => campaign.servable)?.name ?? null);

  // Step 4 "Wait for <vendor>": listen for their first post on the new key (test posts once 20261112100100 marks them).
  useEffect(() => {
    if (step !== 4 || !minted) return;
    if (!listeningSince.current) listeningSince.current = new Date().toISOString();
    const timer = window.setInterval(() => {
      void send<PostActivity>("/api/app/lead-post-keys/activity", "GET").then((activity) => {
        const first = activity.recent.find((post) => post.keyId === minted.record.id && post.receivedAt >= listeningSince.current);
        if (first) setTheirs(first);
      }).catch(() => null);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [step, minted]);

  async function makeKey() {
    setBusy(true);
    setError(null);
    try {
      const body = await send<Minted>("/api/app/lead-post-keys", "POST", {
        ...(vendor ? { vendorId: vendor.id } : { vendorName: vendorText.trim() }),
        ...(campaignId ? { campaignId } : {}),
        ...(r8 ? { testMode: true, priceCents: priceCents === null || Number.isNaN(priceCents) ? null : priceCents } : {}),
      });
      setMinted(body);
      setStep(2);
      await onConnected(body.record.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The key could not be made.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (!minted) return;
    setBusy(true);
    try {
      setResult(await send<TestResult>(`/api/app/lead-post-keys/${minted.record.id}/test`, "POST", { payload: payloadFor(lead, minted.record.fieldMap) }));
    } catch (cause) {
      notify.fail(cause instanceof Error ? cause.message : "The test could not run.");
    } finally {
      setBusy(false);
    }
  }

  async function finish(goLive: boolean) {
    if (minted && r8) {
      try {
        await send(`/api/app/lead-post-keys/${minted.record.id}`, "PATCH", { action: "settings", settings: { testMode: !goLive } });
        notify.done(goLive ? `${vendorName} is live. Their posts become leads.` : `${vendorName} stays in test mode until you go live from their sheet.`);
      } catch (cause) {
        notify.fail(cause instanceof Error ? cause.message : "That did not change.");
        return;
      }
    } else if (minted) {
      notify.done(`${vendorName} is connected.`);
    }
    if (minted) await onConnected(minted.record.id);
    onClose();
  }

  // Past step 1 the key exists; closing keeps the vendor, and the key is gone from the screen for good.
  const requestClose = () => { if (!busy) onClose(); };

  const header = (title: string, sub: string) => (
    <DialogHeader>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{sub}</DialogDescription>
      <ol aria-label="Steps" className="m-0 mt-2 flex list-none flex-wrap items-center gap-2 p-0 text-xs">
        {STEPS.map((label, index) => {
          const n = (index + 1) as Step;
          const done = n < step;
          return (
            <li key={label} className="flex items-center gap-2">
              {index > 0 && <span aria-hidden="true" className="h-px w-5 bg-[var(--border)]" />}
              <span className={cn("flex items-center gap-1.5", n === step ? "font-semibold text-[var(--ink)]" : "text-[var(--muted)]")} aria-current={n === step ? "step" : undefined}>
                <span className={cn("grid size-5 place-items-center rounded-full text-xs", done ? "bg-[var(--primary)] text-[var(--on-primary)]" : n === step ? "border-2 border-[var(--primary)]" : "border border-[var(--border-strong)]")}>
                  {done ? <Check aria-hidden="true" className="size-3" /> : n}
                </span>
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </DialogHeader>
  );

  return (
    <Dialog open onOpenChange={(next) => { if (!next) requestClose(); }}>
      <DialogContent size={step === 3 ? "2xl" : "lg"} className="max-h-[90vh] overflow-y-auto">
        {step === 1 && (
          <>
            {header("Connect a vendor", r8 ? "About three minutes. Nothing is live until the first test passes." : "About three minutes. Their key works as soon as it is made.")}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Vendor" htmlFor="wizard-vendor" hint={vendor?.connected ? `${vendor.name} already has a key. Open their sheet to rotate it.` : isNew ? `${vendorText.trim()} will be added to your lead sources.` : "Pick a lead source or type a new name"}>
                <input id="wizard-vendor" list="wizard-vendors" className={control} autoComplete="off" value={vendorText} onChange={(event) => { setVendorText(event.target.value); setCampaignId(""); }} placeholder="QuoteWizard" />
                <datalist id="wizard-vendors">
                  {board.allVendors.filter((item) => !item.connected).map((item) => <option key={item.id} value={item.name} />)}
                </datalist>
              </Field>
              <Field label={<>Price per accepted lead{!r8 && <NeedsUpdate />}</>} htmlFor="wizard-price" error={priceCents !== null && Number.isNaN(priceCents) ? "Enter dollars and cents, like 15.00." : null}>
                <input id="wizard-price" className={control} inputMode="decimal" placeholder="$0.00" value={price} disabled={!r8} onChange={(event) => setPrice(event.target.value)} />
              </Field>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-label text-[var(--body)]">Which campaign do their leads go to?</span>
              {!board.schemaReady && <p className="m-0 text-xs text-[var(--muted)]">Choosing a campaign needs a database update; their posts go to their first active, scrubbed campaign.</p>}
              <ChoiceCard name="wizard-campaign" selected={!campaignId} onSelect={() => setCampaignId("")} title="Their first open campaign" sub="Whichever of their campaigns is active and scrubbed" />
              {campaigns.map((campaign) => (
                <ChoiceCard
                  key={campaign.id}
                  name="wizard-campaign"
                  selected={campaignId === campaign.id}
                  disabled={!board.schemaReady || !campaign.intakeForm}
                  onSelect={() => setCampaignId(campaign.id)}
                  title={campaign.name}
                  sub={campaign.intakeForm ? `${campaign.productLabel} intake form · ${campaign.status}` : "This product has no intake form, so posts would be refused"}
                  end={campaign.intakeForm ? (campaign.servable ? "Scrubbed" : "Not scrubbed yet") : <Link href="/app/settings#form-templates" className="font-semibold text-[var(--accent-ink)] hover:underline">Add an intake form</Link>}
                />
              ))}
              {vendorText.trim() && campaigns.length === 0 && (
                <p className="m-0 text-xs text-[var(--muted)]">{vendorText.trim()} has no campaign yet. Their key works once one is active and scrubbed. <Link href="/app/campaigns" className="font-semibold text-[var(--accent-ink)] hover:underline">Add a campaign</Link></p>
              )}
            </div>
            {error && <p role="alert" className="m-0 text-xs text-[var(--error-ink)]">{error}</p>}
            <DialogFooter className="items-center">
              <Button type="button" variant="ghost" onClick={requestClose}>Cancel</Button>
              <span className="text-xs text-[var(--muted)] sm:ml-auto">Next makes their key</span>
              <Button type="button" disabled={!canNext1 || busy} onClick={() => void makeKey()}>{busy ? "Making the key…" : "Next: make the key"}</Button>
            </DialogFooter>
          </>
        )}

        {step === 2 && minted && (
          <>
            {header(`${vendorName}'s key`, [campaignName, priceCents && !Number.isNaN(priceCents) ? `${dollars(priceCents)} per accepted lead` : null].filter(Boolean).join(" · ") || "Shown once")}
            <KeyBox value={minted.key} postingUrl={postingUrl} />
            <label className="flex items-center gap-2 text-sm text-[var(--body)]">
              <input type="checkbox" className={checkboxControl} checked={copied} onChange={(event) => setCopied(event.target.checked)} />
              I&rsquo;ve copied the key somewhere safe
            </label>
            <DialogFooter>
              <Button type="button" disabled={!copied} onClick={() => setStep(3)}>Next: send instructions</Button>
            </DialogFooter>
          </>
        )}

        {step === 3 && minted && (
          <>
            {header(`Send ${vendorName} their instructions`, "Everything their developer needs, on one page. You can resend it later from the vendor's sheet.")}
            <div className="grid min-w-0 grid-cols-1 gap-5 md:grid-cols-[260px_minmax(0,1fr)]">
              <div className="flex flex-col gap-3">
                <Field label="Email to" htmlFor="wizard-email"><input id="wizard-email" type="email" className={control} placeholder="dev@vendor.com" value={emailTo} onChange={(event) => setEmailTo(event.target.value)} /></Field>
                <Field label="Copy to" htmlFor="wizard-cc"><input id="wizard-cc" type="email" className={control} placeholder="Your rep or another address" value={copyTo} onChange={(event) => setCopyTo(event.target.value)} /></Field>
                <div className="flex items-center justify-between gap-3 text-sm text-[var(--body)]">
                  <span>Include the key</span>
                  <Switch checked={false} disabled label="Include the key" />
                </div>
                <p className="m-0 text-xs text-[var(--muted)]">The guide says &ldquo;use the key we sent separately&rdquo;. We keep only a fingerprint of the key, so it is never put in an email or a link.</p>
                <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3">
                  <Button type="button" disabled={!emailTo.trim()} onClick={() => void emailInstructions({ keyId: minted.record.id, vendorName, to: emailTo, cc: copyTo, agencyName: board.agencyName, recordSent: r8 })}>Email to vendor</Button>
                  <Button type="button" variant="outline" onClick={() => downloadInstructions(minted.record.id)}>Download PDF</Button>
                  {r8
                    ? <Button type="button" variant="outline" onClick={() => void copyInstructionsLink(minted.record.id)}>Copy link to this page</Button>
                    : <Button type="button" variant="outline" onClick={() => void copyInstructions(minted.record.id)}>Copy the instructions</Button>}
                </div>
                <p className="m-0 text-xs text-[var(--muted)]">{r8 ? "Their sheet shows when the link is opened." : <>Seeing when they open it<NeedsUpdate /></>}</p>
              </div>
              <GuideDoc input={{ agencyName: board.agencyName, vendorName, campaignName, postingUrl, fieldMap: minted.record.fieldMap }} />
            </div>
            <DialogFooter className="items-center">
              <Button type="button" variant="ghost" onClick={() => setStep(2)}>Back</Button>
              <span className="text-xs text-[var(--muted)] sm:ml-auto">You can skip and send later</span>
              <Button type="button" variant="outline" onClick={() => setStep(4)}>Skip</Button>
              <Button type="button" onClick={() => setStep(4)}>Next: test post</Button>
            </DialogFooter>
          </>
        )}

        {step === 4 && minted && (
          <>
            {header("Send a test post", r8 ? `Test mode is on for ${vendorName} until you go live.` : `${vendorName}'s key already works; a test from here never makes a lead.`)}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ChoiceCard name="wizard-test" selected={mode === "send"} onSelect={() => setMode("send")} title="Send one from here" sub="A made-up lead through their field map" />
              <ChoiceCard name="wizard-test" selected={mode === "wait"} onSelect={() => setMode("wait")} title={`Wait for ${vendorName}`} sub="We listen for their first post" />
            </div>
            {mode === "send" && (
              <div className="flex flex-col gap-2">
                <span className="text-label text-[var(--body)]">Test lead</span>
                <div className="flex min-w-0 items-center gap-2 rounded-[8px] border border-[var(--border-strong)] px-3 py-2 text-sm text-[var(--ink)]">
                  <span className="min-w-0 flex-1 truncate">{describeLead(lead)}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditingLead(true)}>Edit</Button>
                </div>
                <div><Button type="button" disabled={busy} onClick={() => void sendTest()}>{busy ? "Sending…" : result ? "Send it again" : "Send the test"}</Button></div>
              </div>
            )}
            {result && <TestResultCard result={result} who="Our test" />}
            {theirs ? (
              <TestResultCard who={`${vendorName}'s ${theirs.isTest ? "test" : "first post"}`} result={{ accepted: theirs.outcome === "accepted", reasonCode: theirs.reasonCode, message: theirs.outcome === "accepted" ? "Every check passed." : "Refused. Open their sheet to see why and fix it.", at: theirs.receivedAt, ms: theirs.processingMs }} />
            ) : (
              <p className="m-0 flex items-center gap-2 text-xs text-[var(--muted)]"><span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-[var(--primary)]" />Still listening for {vendorName}&rsquo;s own post…</p>
            )}
            <DialogFooter className="items-center">
              <Button type="button" variant="ghost" onClick={() => setStep(3)}>Back</Button>
              <span className="sm:ml-auto" />
              {r8 && <Button type="button" variant="outline" onClick={() => void finish(false)}>Finish, stay in test mode</Button>}
              <Button type="button" onClick={() => void finish(true)}>{r8 ? "Go live" : "Done"}</Button>
            </DialogFooter>
            {editingLead && <TestLeadDialog open lead={lead} onClose={() => setEditingLead(false)} onSave={setLead} />}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
