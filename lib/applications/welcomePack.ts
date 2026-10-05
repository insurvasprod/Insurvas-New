import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { escapeHtml } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/transport";
import { effectiveCarrierFacts } from "@/lib/salesSettings/carriers";
import { resolveSalesSettings } from "@/lib/salesSettings/schema";
import { auditAfterSubmit } from "./afterAudit";
import { householdTotal, missingLockedFacts, renderWelcomeTemplate, sameEmail, welcomePackPath, type WelcomeFacts } from "./afterSubmitRules";
import { BENEFICIARY_RELATIONSHIP_LABEL, PRODUCT_LABEL } from "./constants";
import { ApplicationError, db, isMissingSchema, rows, SchemaPendingError } from "./db";
import { attemptHead, fail, type Actor } from "./requirements";
import { getCaseView } from "./service";
import type { AttemptView, CaseView } from "./types";

/**
 * LA-3.20 welcome pack: on submit, a PDF of what the client agreed to — carrier, amount, draft day,
 * what their bank statement will show and who to call — stored privately beside the confirmation,
 * and (when the agency's auto-send is on and there is an email) sent once. Never twice for the same
 * attempt: the send is claimed with a compare-and-set before the mail leaves. A resubmission is a
 * new attempt and gets its own row and its own PDF; an accepted counteroffer (LA-3.26) writes a new
 * PDF version beside the old one, which is never altered. Spouses who share an email (LA-3.24) get
 * one email stating both premiums and the combined total.
 */

export const WELCOME_BUCKET = "application-confirmations";

type PackRow = {
  id: string; application_id: string; attempt_no: number; pdf_path: string | null; recipient_email: string | null; email_status: "not_sent" | "queued" | "sent" | "bounced" | "review";
  sent_at: string | null; bounced_at: string | null; bounce_reason: string | null; household_group: string | null;
  send_note?: string | null; pdf_version?: number; reissued_at?: string | null; generated_at?: string | null; sent_version?: number | null; updated_at: string;
};
const BASE_COLUMNS = "id, application_id, attempt_no, pdf_path, recipient_email, email_status, sent_at, bounced_at, bounce_reason, household_group, updated_at";
const FULL_COLUMNS = `${BASE_COLUMNS}, send_note, pdf_version, reissued_at, generated_at, sent_version`;
const SENDING = "Sending…";

async function packRow(tenantId: string, applicationId: string): Promise<PackRow | null> {
  let q = await db().from("tenant_welcome_packs").select(FULL_COLUMNS).eq("tenant_id", tenantId).eq("application_id", applicationId).maybeSingle();
  if (q.error && isMissingSchema(q.error)) q = await db().from("tenant_welcome_packs").select(BASE_COLUMNS).eq("tenant_id", tenantId).eq("application_id", applicationId).maybeSingle();
  if (q.error) { if (isMissingSchema(q.error)) throw new SchemaPendingError("The welcome pack"); fail(q.error, "Could not load the welcome pack"); }
  return (q.data ?? null) as PackRow | null;
}

/** Update a pack row, dropping the delivery columns if their migration is not live yet. */
async function patchPack(tenantId: string, id: string, patch: Record<string, unknown>, claimFor?: { firstSend: boolean }) {
  const run = async (p: Record<string, unknown>): Promise<{ data: unknown; error: { code?: string; message?: string } | null }> => {
    let q = db().from("tenant_welcome_packs").update(p).eq("tenant_id", tenantId).eq("id", id);
    if (claimFor) {
      q = q.neq("email_status", claimFor.firstSend ? "sent" : "queued").or(`send_note.is.null,send_note.neq.${SENDING}`);
      if (claimFor.firstSend) q = q.is("sent_at", null);
    }
    return q.select("id");
  };
  let r = await run(patch);
  if (r.error && isMissingSchema(r.error)) {
    const { send_note: _a, pdf_version: _b, reissued_at: _c, generated_at: _d, sent_version: _e, ...rest } = patch;
    void _a; void _b; void _c; void _d; void _e;
    r = await run(rest);
  }
  if (r.error) fail(r.error, "Could not update the welcome pack");
  return rows<{ id: string }>(r.data).length > 0;
}

// ── facts ──────────────────────────────────────────────────────────────────

const money = (cents: number) => `$${Math.floor(cents / 100).toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;
const face = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (typeof v === "number" ? v : null);

/** Effective coverage: the application's cov.* values (an accepted counteroffer wrote them), else the selected quote. */
export function effectiveCoverage(a: AttemptView) {
  const q = a.quotes.find((x) => x.id === a.selectedQuoteId) ?? null;
  return {
    faceCents: num(a.values["cov.face_amount"]?.value) ?? q?.faceAmountCents ?? 0,
    monthlyCents: num(a.values["cov.monthly_premium"]?.value) ?? q?.monthlyPremiumCents ?? 0,
    tier: str(a.values["cov.product_tier"]?.value) || q?.tier || null,
  };
}

function insuredName(view: CaseView, a: AttemptView) {
  const n = [str(a.values["insured.first_name"]?.value), str(a.values["insured.last_name"]?.value)].filter(Boolean).join(" ");
  return n || (a.insuredRole === "primary" ? view.clientName : "Spouse");
}

type Agent = { name: string; email: string; phone: string };

async function agentFor(tenantId: string, applicationId: string, fallbackUserId: string): Promise<Agent> {
  const sub = await db().from("tenant_application_submissions").select("created_by").eq("tenant_id", tenantId).eq("application_id", applicationId).order("submitted_at", { ascending: false }).limit(1).maybeSingle();
  const userId = (sub.data?.created_by as string | undefined) ?? fallbackUserId;
  const u = await db().from("users").select("name, email, phone").eq("id", userId).maybeSingle();
  return { name: str(u.data?.name) || "Your agent", email: str(u.data?.email), phone: str(u.data?.phone) };
}

async function factsFor(tenantId: string, view: CaseView, a: AttemptView, agent: Agent): Promise<WelcomeFacts> {
  const cov = effectiveCoverage(a);
  let descriptor = "";
  if (a.carrierId) {
    // The agency's own descriptor first, then the library's (LA-3.17 carrier overrides).
    const facts = await effectiveCarrierFacts(tenantId, [a.carrierId]).catch(() => new Map());
    descriptor = str(facts.get(a.carrierId)?.billingDescriptor);
  }
  const p = a.payment;
  const draft = !p ? "" : p.method === "direct_bill" ? "date on your bill (it is not drafted)" : p.draftDay ? ordinal(p.draftDay) : "";
  const bens = a.beneficiaries.filter((b) => b.tier === "primary").map((b) => {
    const rel = b.relationship === "other" ? b.relationship_other ?? "" : b.relationship ? BENEFICIARY_RELATIONSHIP_LABEL[b.relationship] : "";
    return `${b.first_name} ${b.last_name}${rel ? ` (${rel.toLowerCase()})` : ""}, ${(b.share_bp / 100).toFixed(2).replace(/\.00$/, "")}%`;
  });
  const sub = [...a.submissions].sort((x, y) => y.submittedAt.localeCompare(x.submittedAt))[0];
  return {
    client_first_name: str(a.values["insured.first_name"]?.value) || insuredName(view, a).split(" ")[0],
    carrier_name: a.carrierName ?? "your insurance company",
    coverage_amount: cov.faceCents ? face(cov.faceCents) : "",
    product_name: a.productLabel ?? (a.productCode ? PRODUCT_LABEL[a.productCode] ?? a.productCode : "life insurance"),
    statement_descriptor: descriptor,
    monthly_amount: cov.monthlyCents ? money(cov.monthlyCents) : "",
    draft_day: draft,
    beneficiaries: bens.length ? bens.join("; ") : "No beneficiary on file",
    reference: sub?.carrierReference ?? "to follow",
    agent_name: agent.name,
    agent_phone: agent.phone,
    agent_email: agent.email,
  };
}

// ── the PDF (pdf-lib, standard fonts) ──────────────────────────────────────

/** Standard fonts are WinAnsi: keep Latin-1 and the few typographic marks it has, swap the rest. */
function safe(text: string) {
  return text.replace(/[−‒]/g, "-").replace(/[·]/g, "·").replace(/[^\u0009\u000a -ÿ—–‘’“”•…€]/g, "?");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split("\n")) {
    if (!para.trim()) { out.push(""); continue; }
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}

async function buildPdf(input: { title: string; facts: WelcomeFacts; letter: string; household: { lines: string[] } | null }) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(safe(input.title));
  pdf.setProducer("Insurvas");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 612, H = 792, M = 56, lineGap = 4;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const ink = rgb(0.08, 0.1, 0.12), muted = rgb(0.38, 0.39, 0.42);
  const ensure = (need: number) => { if (y - need < M) { page = pdf.addPage([W, H]); y = H - M; } };
  const text = (t: string, opts: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; width?: number } = {}) => {
    const size = opts.size ?? 11;
    for (const l of wrap(t, opts.f ?? font, size, opts.width ?? W - 2 * M - (opts.x ?? 0))) {
      ensure(size + lineGap);
      page.drawText(l, { x: M + (opts.x ?? 0), y: y - size, size, font: opts.f ?? font, color: opts.color ?? ink });
      y -= size + lineGap;
    }
  };

  text(input.title, { size: 20, f: bold });
  y -= 6;
  text(`${input.facts.carrier_name} · ${input.facts.product_name}`, { color: muted });
  y -= 14;

  // The four facts that can never be removed, first, in a box.
  const rowsOut: [string, string][] = [
    ["Coverage", input.facts.coverage_amount || "—"],
    ["Monthly amount", input.facts.monthly_amount || "—"],
    ["Draft day", input.facts.draft_day || "—"],
    ["Your bank statement will show", input.facts.statement_descriptor || "—"],
    ["Application number", input.facts.reference],
    ["The money goes to", input.facts.beneficiaries],
    ["Your agent", [input.facts.agent_name, input.facts.agent_phone, input.facts.agent_email].filter(Boolean).join(" · ")],
  ];
  const boxTop = y;
  y -= 12;
  for (const [label, value] of rowsOut) {
    const before = y;
    text(label, { size: 10, color: muted, x: 12, width: 170 });
    const afterLabel = y;
    y = before;
    text(value, { size: 11, f: bold, x: 190, width: W - 2 * M - 202 });
    y = Math.min(y, afterLabel) - 4;
  }
  page.drawRectangle({ x: M, y: y, width: W - 2 * M, height: boxTop - y, borderColor: rgb(0.84, 0.86, 0.89), borderWidth: 1 });
  y -= 22;

  if (input.household) {
    text("Your household", { size: 12, f: bold });
    for (const l of input.household.lines) text(l);
    y -= 10;
  }
  text(input.letter);
  return pdf.save();
}

// ── generate ───────────────────────────────────────────────────────────────

async function context(actor: Actor, applicationId: string) {
  const head = await attemptHead(actor.tenantId, applicationId, { allowClosed: true });
  if (head.status === "draft" || head.status === "ready") throw new ApplicationError("APPLICATION_NOT_SUBMITTED", "The welcome pack is made once the submission is recorded.", 409);
  const view = await getCaseView(actor.tenantId, head.case_id);
  const attempt = view.attempts.find((x) => x.id === applicationId);
  if (!attempt) throw new ApplicationError("APPLICATION_NOT_FOUND", "That application could not be found.", 404);
  const settings = resolveSalesSettings((await db().from("tenant_sales_settings").select("settings").eq("tenant_id", actor.tenantId).maybeSingle()).data?.settings);
  return { head, view, attempt, settings };
}

/** Write a PDF for the attempt as version `version`, and the pack row that points at it. */
async function writePdf(actor: Actor, ctx: Awaited<ReturnType<typeof context>>, existing: PackRow | null, note: string | null) {
  const { view, attempt, settings } = ctx;
  const agent = await agentFor(actor.tenantId, attempt.id, actor.userId);
  const facts = await factsFor(actor.tenantId, view, attempt, agent);
  const letter = renderWelcomeTemplate(settings.welcomePack, facts);
  const version = existing?.pdf_path ? (existing.pdf_version ?? 1) + 1 : existing?.pdf_version ?? 1;
  const path = welcomePackPath(actor.tenantId, attempt.id, attempt.attemptNo, version);
  const bytes = await buildPdf({ title: `Welcome, ${facts.client_first_name}`, facts, letter: letter.body, household: null });
  // upsert: false — an older version is never overwritten (LA-3.20, "without altering the old one").
  const up = await db().storage.from(WELCOME_BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (up.error && !/already exists|Duplicate/i.test(up.error.message ?? "")) throw new ApplicationError("WELCOME_PACK_STORAGE", `Could not store the welcome pack: ${up.error.message}`, 500);
  const now = new Date().toISOString();
  const recipient = str(attempt.values["contact.email"]?.value) || null;
  const validRecipient = recipient && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) ? recipient : null;
  if (!existing) {
    const row: Record<string, unknown> = { tenant_id: actor.tenantId, application_id: attempt.id, attempt_no: attempt.attemptNo, pdf_path: path, recipient_email: validRecipient, email_status: "not_sent", pdf_version: version, generated_at: now, send_note: note };
    let ins = await db().from("tenant_welcome_packs").insert(row).select(FULL_COLUMNS).single();
    if (ins.error && isMissingSchema(ins.error)) {
      const { pdf_version: _v, generated_at: _g, send_note: _n, ...rest } = row;
      void _v; void _g; void _n;
      ins = await db().from("tenant_welcome_packs").insert(rest).select(BASE_COLUMNS).single();
    }
    if (ins.error?.code === "23505") return { row: (await packRow(actor.tenantId, attempt.id))!, facts, letter };
    if (ins.error) { if (isMissingSchema(ins.error)) throw new SchemaPendingError("The welcome pack"); fail(ins.error, "Could not record the welcome pack"); }
    return { row: ins.data as PackRow, facts, letter };
  }
  await patchPack(actor.tenantId, existing.id, {
    pdf_path: path, pdf_version: version, generated_at: now, ...(existing.pdf_path ? { reissued_at: now } : {}),
    ...(existing.email_status !== "sent" ? { recipient_email: validRecipient } : {}), ...(note !== null ? { send_note: note } : {}),
  });
  return { row: (await packRow(actor.tenantId, attempt.id))!, facts, letter };
}

/** A new PDF version after the terms changed (LA-3.26). No email: the agent sends the update deliberately. */
export async function regenerateWelcomePack(actor: Actor, applicationId: string, note: string) {
  const ctx = await context(actor, applicationId);
  const existing = await packRow(actor.tenantId, applicationId);
  const { row } = await writePdf(actor, ctx, existing, existing?.sent_at ? `${note} Send the updated pack so the client has the new amount in writing.` : note);
  await auditAfterSubmit({ actorId: actor.userId, action: "tenant.application_welcome_pack_sent", targetId: applicationId, metadata: { action: "regenerate", version: row.pdf_version ?? 1 }, request: actor.request });
  return { version: row.pdf_version ?? 1 };
}

/** The stored PDF as an email attachment; null when it can't be read (the email still goes, without it). */
async function packAttachment(tenantId: string, row: PackRow, filename: string) {
  if (!row.pdf_path || !row.pdf_path.startsWith(`${tenantId}/`)) return null;
  const file = await db().storage.from(WELCOME_BUCKET).download(row.pdf_path);
  if (file.error || !file.data) return null;
  return { filename, content: new Uint8Array(await file.data.arrayBuffer()), contentType: "application/pdf" };
}

// ── deliver ────────────────────────────────────────────────────────────────

type Delivery = { status: PackRow["email_status"]; note: string | null; household: boolean };

/** Claim the send (compare-and-set): only one caller ever gets past this for a given version. */
async function claim(tenantId: string, row: PackRow, reissue: boolean) {
  // A first send needs no earlier send (sent_at null); a reissue keeps email_status 'sent' so it is
  // claimed by its note instead. Either way a second concurrent caller finds the row taken.
  return patchPack(tenantId, row.id, reissue ? { send_note: SENDING } : { email_status: "queued", send_note: SENDING }, { firstSend: !reissue });
}

function htmlOf(body: string) {
  return `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#1a1b1c;line-height:1.6;max-width:560px">${escapeHtml(body).split("\n").map((l) => (l ? `<p style="margin:0 0 8px">${l}</p>` : "")).join("")}</div>`;
}

async function deliver(actor: Actor, ctx: Awaited<ReturnType<typeof context>>, row: PackRow, facts: WelcomeFacts, letter: { subject: string; body: string }, opts: { explicit: boolean; reissue: boolean }): Promise<Delivery> {
  const { view, attempt } = ctx;
  const recipient = row.recipient_email ?? (str(attempt.values["contact.email"]?.value) || null);
  if (!recipient) {
    await patchPack(actor.tenantId, row.id, { email_status: "not_sent", send_note: "No email on file — the PDF is ready to print or post." });
    return { status: "not_sent", note: "No email on file — the PDF is ready to print or post.", household: false };
  }
  const missing = missingLockedFacts(facts);
  if (missing.length) {
    const note = `Held: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing, and the pack never goes out without ${missing.length === 1 ? "it" : "them"}.`;
    await patchPack(actor.tenantId, row.id, { email_status: "review", send_note: note.slice(0, 500) });
    return { status: "review", note, household: false };
  }

  // Household (LA-3.24): the other insured on this case, at the same address.
  const other = view.attempts.filter((x) => x.insuredRole !== attempt.insuredRole).sort((x, y) => y.attemptNo - x.attemptNo)[0] ?? null;
  const shared = other && sameEmail(other.values["contact.email"]?.value, recipient) ? other : null;
  let otherRow: PackRow | null = null;
  let otherFacts: WelcomeFacts | null = null;
  if (shared && !opts.reissue) {
    otherRow = await packRow(actor.tenantId, shared.id);
    const otherSubmitted = shared.status !== "draft" && shared.status !== "ready" && !(shared.status === "closed" && !shared.submittedAt);
    if (otherRow?.sent_at) {
      otherRow = null; // They were told separately already; this one goes alone.
    } else if (!otherSubmitted && shared.status !== "closed" && !opts.explicit) {
      const note = `Held so one email covers both — it goes when ${insuredName(view, shared)}'s application is submitted. Send now to send this one alone.`;
      await patchPack(actor.tenantId, row.id, { email_status: "queued", household_group: view.caseId, send_note: note.slice(0, 500) });
      return { status: "queued", note, household: true };
    } else if (otherSubmitted) {
      if (!otherRow) {
        const ctx2 = await context(actor, shared.id);
        otherRow = (await writePdf(actor, ctx2, null, null)).row;
      }
      otherFacts = await factsFor(actor.tenantId, view, shared, await agentFor(actor.tenantId, shared.id, actor.userId));
      if (missingLockedFacts(otherFacts).length) { otherRow = null; otherFacts = null; }
    } else {
      otherRow = null;
    }
  }

  if (!(await claim(actor.tenantId, row, opts.reissue))) {
    const now = await packRow(actor.tenantId, attempt.id);
    return { status: now?.email_status ?? "sent", note: "Already sent — a welcome pack goes out once per attempt.", household: false };
  }
  const otherClaimed = otherRow ? await claim(actor.tenantId, otherRow, false) : false;

  let body = letter.body;
  if (otherClaimed && shared && otherFacts) {
    const mine = effectiveCoverage(attempt).monthlyCents;
    const theirs = effectiveCoverage(shared).monthlyCents;
    const total = householdTotal([mine, theirs]).totalCents;
    body += [
      "", "Your household", "",
      `${insuredName(view, attempt)}: ${money(mine)} a month with ${attempt.carrierName ?? "the carrier"}, drafted on the ${facts.draft_day}. Statement shows: ${facts.statement_descriptor}.`,
      `${insuredName(view, shared)}: ${money(theirs)} a month with ${shared.carrierName ?? "the carrier"}, drafted on the ${otherFacts.draft_day}. Statement shows: ${otherFacts.statement_descriptor}.`,
      `Together: ${money(total)} a month — two separate drafts, so your statement shows both amounts.`,
    ].join("\n");
  }
  const version = row.pdf_version ?? 1;
  // LA-3.20 · the pack itself goes with the email: the client keeps the PDF, not only a link.
  const attachments = (await Promise.all([
    packAttachment(actor.tenantId, row, `welcome-pack-${attempt.attemptNo}.pdf`),
    otherClaimed && otherRow ? packAttachment(actor.tenantId, otherRow, `welcome-pack-household.pdf`) : Promise.resolve(null),
  ])).filter((a): a is NonNullable<typeof a> => a !== null);
  const result = await sendEmail({
    to: recipient, subject: opts.reissue ? `Updated: ${letter.subject}` : letter.subject, text: body, html: htmlOf(body), templateKey: "application.welcome_pack",
    tenantId: actor.tenantId, userId: actor.userId, dedupeKey: `welcome-pack:${attempt.id}:v${version}`, replyTo: facts.agent_email || undefined,
    attachments,
  });
  const now = new Date().toISOString();
  const rowsToMark: { row: PackRow; version: number }[] = [{ row, version }, ...(otherClaimed && otherRow ? [{ row: otherRow, version: otherRow.pdf_version ?? 1 }] : [])];
  let status: Delivery["status"];
  let note: string | null;
  if (result.delivered) {
    status = "sent";
    note = otherClaimed ? "One email covered both applications, with the combined total." : null;
    for (const r of rowsToMark) await patchPack(actor.tenantId, r.row.id, { email_status: "sent", sent_at: now, sent_version: r.version, recipient_email: recipient, send_note: note, ...(otherClaimed ? { household_group: view.caseId } : {}) });
  } else if (result.reason === "provider_rejected") {
    status = "bounced";
    note = "The mail server refused it — check the email address.";
    for (const r of rowsToMark) await patchPack(actor.tenantId, r.row.id, { email_status: "bounced", bounced_at: now, bounce_reason: "Rejected by the mail server", recipient_email: recipient, send_note: note });
  } else {
    // Delivery is switched off or not configured here: nothing left, nothing is marked sent.
    status = "review";
    note = "Email delivery is not switched on for this workspace — nothing was sent. The PDF is ready.";
    for (const r of rowsToMark) await patchPack(actor.tenantId, r.row.id, { email_status: "review", recipient_email: recipient, send_note: note });
  }
  await auditAfterSubmit({ actorId: actor.userId, action: "tenant.application_welcome_pack_sent", targetId: attempt.id, metadata: { status, version, household: otherClaimed, reissue: opts.reissue }, request: actor.request });
  return { status, note, household: otherClaimed };
}

/**
 * The one entry point the route calls.
 *   submit   — what submitting does: the PDF, then the email if auto-send is on (else held for review)
 *   generate — the PDF only (the first one, or a fresh version)
 *   send     — the agent sends it now; once per attempt
 *   reissue  — the agent sends the updated version after an accepted counteroffer
 */
export async function runWelcomePack(actor: Actor, applicationId: string, action: "submit" | "generate" | "send" | "reissue") {
  const ctx = await context(actor, applicationId);
  let row = await packRow(actor.tenantId, applicationId);
  let facts: WelcomeFacts | null = null;
  let letter: { subject: string; body: string } | null = null;

  if (!row?.pdf_path || action === "generate") {
    const written = await writePdf(actor, ctx, row, null);
    row = written.row; facts = written.facts; letter = written.letter;
  }
  if (!facts || !letter) {
    facts = await factsFor(actor.tenantId, ctx.view, ctx.attempt, await agentFor(actor.tenantId, applicationId, actor.userId));
    letter = renderWelcomeTemplate(ctx.settings.welcomePack, facts);
  }

  let delivery: Delivery | null = null;
  if (action === "submit") {
    if (row.sent_at) delivery = { status: row.email_status, note: "Already sent — a welcome pack goes out once per attempt.", household: false };
    else if (!ctx.settings.welcomePackAutoSend) {
      const note = "Auto-send is off for this agency — check the pack, then send it.";
      await patchPack(actor.tenantId, row.id, { email_status: "review", send_note: note });
      delivery = { status: "review", note, household: false };
    } else delivery = await deliver(actor, ctx, row, facts, letter, { explicit: false, reissue: false });
  } else if (action === "send") {
    if (row.sent_at) throw new ApplicationError("WELCOME_PACK_SENT", "The welcome pack has already been sent for this attempt.", 409);
    delivery = await deliver(actor, ctx, row, facts, letter, { explicit: true, reissue: false });
  } else if (action === "reissue") {
    const version = row.pdf_version ?? 1;
    if (!row.sent_at) throw new ApplicationError("WELCOME_PACK_NOT_SENT", "Nothing has been sent yet — send the pack instead.", 409);
    if ((row.sent_version ?? 1) >= version) throw new ApplicationError("WELCOME_PACK_CURRENT", "The client already has this version.", 409);
    delivery = await deliver(actor, ctx, row, facts, letter, { explicit: true, reissue: true });
  } else {
    await auditAfterSubmit({ actorId: actor.userId, action: "tenant.application_welcome_pack_sent", targetId: applicationId, metadata: { action: "generate", version: row.pdf_version ?? 1 }, request: actor.request });
  }
  return { pack: await welcomePackStatus(actor.tenantId, applicationId), delivery };
}

// ── read ───────────────────────────────────────────────────────────────────

export type WelcomePackStatus = {
  status: PackRow["email_status"]; recipient: string | null; sentAt: string | null; bouncedAt: string | null; bounceReason: string | null;
  note: string | null; version: number; sentVersion: number | null; generatedAt: string | null; household: boolean; pdfUrl: string | null;
};

/** Status and a 60-second signed URL for the current PDF, tenant-checked. */
export async function welcomePackStatus(tenantId: string, applicationId: string): Promise<WelcomePackStatus | null> {
  await attemptHead(tenantId, applicationId, { allowClosed: true });
  const row = await packRow(tenantId, applicationId);
  if (!row) return null;
  let pdfUrl: string | null = null;
  if (row.pdf_path && row.pdf_path.startsWith(`${tenantId}/`)) {
    const s = await db().storage.from(WELCOME_BUCKET).createSignedUrl(row.pdf_path, 60);
    pdfUrl = s.data?.signedUrl ?? null;
  }
  return {
    status: row.email_status, recipient: row.recipient_email, sentAt: row.sent_at, bouncedAt: row.bounced_at, bounceReason: row.bounce_reason,
    note: row.send_note === SENDING ? "Sending…" : row.send_note ?? null, version: row.pdf_version ?? 1, sentVersion: row.sent_version ?? (row.sent_at ? 1 : null),
    generatedAt: row.generated_at ?? null, household: Boolean(row.household_group), pdfUrl,
  };
}
