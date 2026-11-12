"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ChoiceList, type Choice } from "@/components/app/book/needs-you/choice-list";
import { refreshStepCounts } from "@/components/app/step-frame/step-rail";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, textareaControl } from "@/components/ui/field";
import { SelectMenu } from "@/components/ui/select-menu";
import { dollars } from "@/lib/agency/constants";
import type { ItemDetail } from "@/lib/needsYou/store";
import { notify } from "@/lib/notify";

export const CREDIT_FORM_ID = "credit-decide";

/**
 * Who gets the credit › an item › Decide (round 7, docs/la4/mockups-r7/commissions.html 3·1): the credit part of the
 * Needs you decision (components/app/book/needs-you/item-decide.tsx, CreditDecide), drawn for the item's own page.
 * The same choices, the same call (/api/app/agency/attribution) and the same rule: a producer and a reason. The
 * strip above holds the row's facts, and the title line holds the primary ("Give the credit and next"), which
 * submits this form by its id; so the form draws no buttons of its own.
 */
export function CreditDecide({ detail, producerIds, nextHref, nextName, listHref, readOnly }: {
  detail: Extract<ItemDetail, { kind: "credit" }>;
  /** user id → producer record, for "{name}'s pay ›". */
  producerIds: Record<string, string>;
  nextHref: string | null;
  nextName: string | null;
  listHref: string;
  readOnly: boolean;
}) {
  const router = useRouter();
  const suggested = [detail.writingNumber, detail.application].filter((p, i, all): p is NonNullable<typeof p> => Boolean(p) && all.findIndex((q) => q?.userId === p!.userId) === i);
  const [choice, setChoice] = useState<string | null>(suggested.length === 1 ? suggested[0].userId : null);
  const [other, setOther] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ who?: string; why?: string }>({});
  const [busy, setBusy] = useState(false);
  const off = readOnly || busy;
  const producerId = choice === "other" ? other : choice;
  const producerName = detail.producers.find((p) => p.userId === producerId)?.name ?? suggested.find((p) => p.userId === producerId)?.name ?? null;
  const record = producerId ? producerIds[producerId] : undefined;

  const choices: Choice<string>[] = [
    ...suggested.map((p) => ({ key: p.userId, label: p.name, hint: [p.userId === detail.writingNumber?.userId && "named by the writing number", p.userId === detail.application?.userId && "submitted the application"].filter(Boolean).join(" · ") })),
    {
      key: "other", label: "Someone else", hint: "any producer in the agency",
      children: <SelectMenu label="Producer" value={other} onChange={(v) => { setOther(v); setErrors((e) => ({ ...e, who: undefined })); }} disabled={off} className="w-full max-w-md" panelAlign="start" options={[{ value: "", label: "Choose a producer" }, ...detail.producers.map((p) => ({ value: p.userId, label: p.name }))]} />,
    },
  ];

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (readOnly || busy) return;
    const missing = { who: producerId ? undefined : "Choose who gets the credit.", why: reason.trim() ? undefined : "Say why, for whoever looks next." };
    setErrors(missing);
    if (missing.who || missing.why) return;
    setBusy(true);
    try {
      const response = await fetch("/api/app/agency/attribution", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: detail.id, producerUserId: producerId, reason: reason.trim() }) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "That did not save.");
      notify.done(nextName ? `Credit given. ${nextName} is open next.` : "Credit given.");
      refreshStepCounts();
      router.push(nextHref ?? listHref);
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That did not save.");
      setBusy(false);
    }
  }

  return (
    <form id={CREDIT_FORM_ID} onSubmit={submit} className="grid gap-4 lg:grid-cols-2" aria-busy={busy}>
      <Card>
        <CardHeader><CardTitle>Who gets the credit?</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          {readOnly ? (
            <p className="m-0 text-sm text-muted-foreground">
              {suggested.length ? suggested.map((p) => p.name).join(" or ") : "Any producer in the agency"}. Paused while the account is read-only.
            </p>
          ) : (
            <Field label={<span className="sr-only">Who gets the credit?</span>} error={errors.who}>
              <ChoiceList name="credit" label="Who gets the credit?" choices={choices} value={choice} onChange={(v) => { setChoice(v); setErrors((e) => ({ ...e, who: undefined })); }} disabled={off} />
            </Field>
          )}
          {!readOnly && (
            <Field label="Why (kept with the decision)" htmlFor="credit-reason" required error={errors.why}>
              <textarea id="credit-reason" className={textareaControl} value={reason} disabled={off} placeholder={suggested.length > 1 ? `e.g. ${suggested[0].name.split(" ")[0]} wrote it; ${suggested[1].name.split(" ")[0]} only keyed the app` : "e.g. who wrote the business"} onChange={(e) => { setReason(e.target.value); setErrors((x) => ({ ...x, why: undefined })); }} />
            </Field>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>When you save</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm leading-[1.6] text-[var(--body)]">
          <p className="m-0">
            {producerName
              ? <>This {dollars(detail.amountCents)} row counts for <strong>{producerName}</strong>: it posts to their ledger and shows in their totals, with your reason.{record && <> <Link href={`/app/producers/${record}?tab=money`} className="font-medium text-[var(--accent-ink)] hover:underline">{producerName.split(" ")[0]}&apos;s pay ›</Link></>}</>
              : "Choose who gets the credit."}
          </p>
          <p className="m-0 text-muted-foreground">If the two agreed to share this policy, record a <Link href="/app/commission-splits" className="font-medium text-[var(--accent-ink)] hover:underline">commission split</Link> instead; every later line then divides by it.</p>
        </CardContent>
      </Card>
    </form>
  );
}
