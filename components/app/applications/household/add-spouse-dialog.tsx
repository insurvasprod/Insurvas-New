"use client";

/**
 * "Link a second application as a household" (LA-3.24; board l3-ov-spouse). The spouse becomes a
 * second insured on this case with their own attempt, interview and check. Only the address, the
 * contact details, the payment method and the draft day can be shared — each one a switch — and a
 * shared value keeps following the primary's until it is detached. Health is never copied.
 */

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Field, ToggleRow, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { householdTotal } from "@/lib/applications/afterSubmitRules";
import { notify } from "@/lib/notify";

import { money, ordinal } from "@/components/app/applications/parts";
import { caseUrl, request } from "@/components/app/applications/submit/api";
import { Overlay } from "@/components/app/applications/submit/overlay";
import { useWorkspace } from "@/components/app/applications/workspace/context";
import { coverageOf } from "@/components/app/applications/outcome/model";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function AddSpouseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return open ? <SpouseForm open={open} onOpenChange={onOpenChange} /> : null;
}

function SpouseForm({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { caseView, attempt, sample, actions } = useWorkspace();
  const primary = caseView.attempts.filter((a) => a.insuredRole === "primary").sort((a, b) => b.attemptNo - a.attemptNo).find((a) => a.status !== "closed")
    ?? caseView.attempts.filter((a) => a.insuredRole === "primary").sort((a, b) => b.attemptNo - a.attemptNo)[0] ?? attempt;
  const v = primary.values;
  const street = str(v["addr.line1"]?.value);
  const place = [str(v["addr.city"]?.value), [str(v["addr.state"]?.value), str(v["addr.zip"]?.value)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const address = [street, place].filter(Boolean).join(", ");
  const phone = str(v["contact.phone"]?.value);
  const email = str(v["contact.email"]?.value);
  const pay = primary.payment;
  const account = pay?.method === "ach" ? pay.account?.hasValue ? `One bank account, ${pay.account.masked.replace(/•+/, "ending ")}, drafted twice.` : "One bank account, drafted twice."
    : pay && (pay.method === "debit_card" || pay.method === "credit_card" || pay.method === "direct_express") ? `One card${pay.card?.hasValue ? `, ${pay.card.masked.replace(/•+/, "ending ")}` : ""}, charged twice.`
    : pay?.method === "direct_bill" ? "Both billed directly." : null;
  const draftDay = pay?.draftDay ?? null;

  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [share, setShare] = useState({ address: Boolean(address), contact: Boolean(phone || email), payment: Boolean(pay), draftDay: Boolean(draftDay) });
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const nameError = parts.length < 2 ? "Enter the spouse's first and last name." : undefined;
  const on = [share.address, share.contact, share.payment, share.draftDay].filter(Boolean).length;
  const mine = coverageOf(primary).monthlyCents || null;
  const total = householdTotal([mine, null]);

  const turns = (() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
    const [y, m, d] = dob.split("-").map(Number);
    const now = new Date();
    const hadBirthday = now.getMonth() + 1 > m || (now.getMonth() + 1 === m && now.getDate() >= d);
    const age = now.getFullYear() - y - (hadBirthday ? 0 : 1);
    if (age < 0 || age > 120) return null;
    const month = new Date(2000, m - 1, 1).toLocaleDateString("en-US", { month: "long" });
    return `Turns ${age + 1} in ${month} — rates change then.`;
  })();

  async function save(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (nameError || saving) return;
    if (sample) { notify.done("Sample data — no spouse application was created."); onOpenChange(false); return; }
    setSaving(true);
    try {
      const r = await request<{ applicationId: string; sharedKeys: string[] }>(caseUrl(caseView.caseId, "/spouse"), {
        method: "POST",
        body: {
          first_name: parts.slice(0, -1).join(" "), last_name: parts[parts.length - 1], dob: dob || null,
          share_address: share.address, share_contact: share.contact, share_payment: share.payment, share_draft_day: share.draftDay,
        },
      });
      if (!r.ok) { notify.block(r.error, { detail: "What you typed is still in the form." }); return; }
      await actions.refresh();
      notify.done(`${parts[0]}'s application is linked`, { detail: "Their interview starts from the beginning — nothing about health was copied." });
      onOpenChange(false);
      router.replace("?insured=spouse&step=interview", { scroll: false });
    } finally {
      setSaving(false);
    }
  }

  const toggles: { key: keyof typeof share; title: string; help: string; available: boolean }[] = [
    { key: "address", title: "Address", help: address ? `${address}. Turn it off and each keeps their own address.` : "No address on the primary application yet.", available: Boolean(address) },
    { key: "contact", title: "Contact details", help: phone || email ? `The same ${[phone && "phone", email && "email"].filter(Boolean).join(" and ")} reach both people.` : "No phone or email on the primary application yet.", available: Boolean(phone || email) },
    { key: "payment", title: "Payment method", help: account ?? "No payment method on the primary application yet.", available: Boolean(pay) },
    { key: "draftDay", title: "Draft day", help: draftDay ? `Both premiums leave on the ${ordinal(draftDay)}, so the statement shows one date.` : "No draft day on the primary application yet.", available: Boolean(draftDay) },
  ];

  return (
    <Overlay
      open={open}
      onOpenChange={(o) => { if (!saving) onOpenChange(o); }}
      width={720}
      title="Link a second application as a household"
      subtitle={[caseView.clientName, address].filter(Boolean).join(" · ")}
      onSubmit={save}
      footerNote="A shared detail keeps following the primary's until it is detached on the spouse's application."
      actions={<>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving} title={saving ? "Saving…" : undefined}>Cancel</Button>
        <Button type="submit" disabled={saving} title={saving ? "Saving…" : undefined}>{saving ? "Creating…" : "Create the linked application"}</Button>
      </>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Spouse’s full name" htmlFor="spouse-name" required error={tried ? nameError : undefined}>
          <input id="spouse-name" className={control} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoFocus />
        </Field>
        <Field label="Date of birth" htmlFor="spouse-dob" hint={turns ?? undefined}>
          <input id="spouse-dob" type="date" className={control} value={dob} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDob(e.target.value)} />
        </Field>
      </div>

      <section aria-label="What the second application copies" className="flex flex-col rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-t-[11px] border-b border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3">
          <h3 className="text-sm font-semibold text-[var(--ink)]">What the second application copies</h3>
          <StatusChip tone="neutral" dot={false}>{on} of 4 on</StatusChip>
        </div>
        {toggles.map((t, i) => (
          <div key={t.key} className={i > 0 ? "border-t border-[var(--border)] px-[18px] py-[13px]" : "px-[18px] py-[13px]"}>
            <ToggleRow id={`share-${t.key}`} title={t.title} help={t.help} checked={share[t.key] && t.available} disabled={!t.available || saving} onChange={(next) => setShare((s) => ({ ...s, [t.key]: next }))} />
          </div>
        ))}
      </section>

      <p className="text-sm text-[var(--body)]"><span className="font-semibold text-[var(--error-ink)]">Health information is never copied.</span> The interview runs again from the start for the second application.</p>

      <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-center gap-5">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-[0.02em] text-[var(--muted)]">Combined monthly total</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-2">
              <span className="text-sm text-[var(--body)] tabular-nums">{money(mine)}</span>
              <span className="text-sm text-[var(--muted)]">+</span>
              <span className="text-sm text-[var(--muted)]">not quoted yet</span>
              <span className="text-sm text-[var(--muted)]">=</span>
              <span className="text-2xl font-semibold text-[var(--ink)] tabular-nums">{money(total.totalCents || null)}</span>
            </div>
            <div className="mt-1 text-xs text-[var(--muted)]">
              {share.payment && draftDay ? `Two drafts on the ${ordinal(draftDay)}, not one. Read them both figures — the bank statement shows them separately.` : "Each application is drafted on its own. Read them both figures."}
            </div>
          </div>
          {share.contact && email && <StatusChip tone="info" dot={false} title="One welcome email covers both policies and the combined total. Detach the email and each gets its own.">One welcome email</StatusChip>}
        </div>
      </div>
    </Overlay>
  );
}
