"use client";

/**
 * Settings › Sales › Welcome pack (board l3-set-welcome-pack, LA-3.20). Reads and saves the
 * `welcomePack` template of the Sales settings document (GET/PUT /api/app/settings/sales/settings);
 * `?preview=sample` reads the default template.
 *
 * The email a client gets after submit, written so the first draft does not surprise them. Four
 * tokens carry that and cannot be removed — the statement descriptor, the monthly amount, the draft
 * day and the agent's phone: the editor refuses a save without them, and so does the schema on the
 * server. Everything around them is the agency's own wording. The preview on the right renders the
 * draft live, with an example client and the signed-in person as the agent.
 */

import { useRef, useState } from "react";
import { notify } from "@/lib/notify";

import { Callout, Field, LockIcon, Pill, SettingsCard, SettingsStack, control } from "@/components/app/settings/primitives";
import { face, money, ordinal } from "@/components/app/applications/parts";
import { Button } from "@/components/ui/button";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { FIXTURE_ATTEMPT, FIXTURE_CASE } from "@/lib/applications/fixtures";
import { SALES_CARRIERS } from "@/lib/applications/settingsFixtures";
import { WELCOME_PACK_TOKENS, missingLockedTokens, tokenParts, unknownTokens } from "@/lib/salesSettings/editing";
import { DEFAULT_WELCOME_PACK, salesSettingsSchema, type SalesSettings } from "@/lib/salesSettings/schema";
import type { SalesSettingsView } from "@/lib/salesSettings/settings";
import { cn } from "@/lib/utils";

import { PanelState, useSalesSettings } from "./prefs-settings";
import { CardFact, DiscardSave, ReadOnlyNotice, SalesPanelTop, changedLine } from "./shared";

const LOCKED = WELCOME_PACK_TOKENS.filter((t) => t.locked);
const OPTIONAL = WELCOME_PACK_TOKENS.filter((t) => !t.locked);

const WHY: Record<string, string> = {
  "{statement_descriptor}": "The biggest cause of a first-month chargeback is a client who does not recognise the line and calls the bank instead of us.",
  "{monthly_amount}": "In dollars, not “your premium”. They agreed to a number and the number has to be in writing.",
  "{draft_day}": "The day the draft-date calculator gave and the day they agreed to.",
  "{agent_phone}": "A client who can reach the agent does not cancel. A direct number, never a support queue.",
};

/* ── the example client the preview renders against ─────────────────────── */

const attempt = FIXTURE_ATTEMPT;
const exampleValues = (me: SalesSettingsView["me"]): Record<string, string> => ({
  "{client_first_name}": FIXTURE_CASE.clientName.split(" ")[0] ?? "",
  "{carrier_name}": attempt.carrierName ?? "",
  "{coverage_amount}": face(Number(attempt.values["cov.face_amount"]?.value ?? 0)),
  "{product_name}": attempt.productLabel ?? "Final Expense",
  "{statement_descriptor}": SALES_CARRIERS.find((c) => c.id === attempt.carrierId)?.billingDescriptor ?? "",
  "{monthly_amount}": money(Number(attempt.values["cov.monthly_premium"]?.value ?? 0)),
  "{draft_day}": ordinal(attempt.payment?.draftDay ?? 3),
  "{beneficiaries}": attempt.beneficiaries.filter((b) => b.tier === "primary").map((b) => `${b.first_name} ${b.last_name}`).join(" and "),
  "{reference}": "Given when it is submitted",
  "{agent_name}": me.name || "Your name",
  "{agent_phone}": me.phone || "Your phone — add it to your profile",
  "{agent_email}": me.email,
});

function Rendered({ text, values }: { text: string; values: Record<string, string> }) {
  return (
    <>
      {tokenParts(text).map((part, i) => {
        if (!part.token) return <span key={i}>{part.text}</span>;
        const value = values[part.token];
        if (value === undefined) return <span key={i} className="rounded-[4px] bg-[var(--warning-surface)] px-1 font-mono text-[14px] text-[var(--warning-ink)]" title="The welcome pack does not know this token.">{part.token}</span>;
        const locked = LOCKED.some((t) => t.token === part.token);
        return locked ? <strong key={i} className="font-semibold text-[var(--ink)]">{value}</strong> : <span key={i}>{value}</span>;
      })}
    </>
  );
}

function Preview({ subject, body, me }: { subject: string; body: string; me: SalesSettingsView["me"] }) {
  const values = exampleValues(me);
  return (
    <SettingsCard title="Preview" sub="An example client, signed with your name and phone." action={<Pill tone="brand">Live</Pill>} pad={20}>
      <dl className="m-0 flex flex-col gap-2">
        <div>
          <dt className="text-[12px] leading-[1.5] text-[var(--muted)]">To</dt>
          <dd className="m-0 text-[14px] leading-[1.5] text-[var(--ink)]">The client&apos;s email on the application</dd>
        </div>
        <div>
          <dt className="text-[12px] leading-[1.5] text-[var(--muted)]">Subject</dt>
          <dd className="m-0 text-[14px] leading-[1.5] font-semibold text-[var(--ink)]"><Rendered text={subject || "No subject"} values={values} /></dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-col gap-3 rounded-[8px] bg-[var(--canvas)] p-3.5 text-[16px] leading-[1.6] tracking-[-0.01em] text-[var(--body)]">
        {body.split(/\n{2,}/).filter((p) => p.trim()).map((paragraph, i) => (
          <p key={i} className="m-0 whitespace-pre-line break-words"><Rendered text={paragraph.trim()} values={values} /></p>
        ))}
      </div>
    </SettingsCard>
  );
}

function Editor({ view, save }: { view: SalesSettingsView; save: (next: SalesSettings) => Promise<unknown> }) {
  const saved = view.settings.welcomePack;
  const [subject, setSubject] = useState(saved.subject);
  const [body, setBody] = useState(saved.body);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const ro = !view.canEdit;

  const dirty = subject !== saved.subject || body !== saved.body;
  const missing = missingLockedTokens(body);
  const unknown = unknownTokens(`${subject}\n${body}`);
  const next: SalesSettings = { ...view.settings, welcomePack: { subject: subject.trim(), body } };
  const valid = missing.length === 0 && subject.trim().length > 0 && salesSettingsSchema.safeParse(next).success;
  const bodyError = missing.length ? `Put ${missing.join(" and ")} back — the email cannot be saved without ${missing.length === 1 ? "it" : "them"}.` : undefined;

  function insert(token: string) {
    if (ro) return;
    const el = bodyRef.current;
    const at = el ? el.selectionStart : body.length;
    const end = el ? el.selectionEnd : body.length;
    setBody(`${body.slice(0, at)}${token}${body.slice(end)}`);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(at + token.length, at + token.length);
    });
  }

  async function onSave() {
    if (!valid) return;
    setSaving(true);
    setSaveError(null);
    try {
      await save(next);
      notify.done("Welcome pack saved", { detail: "The next pack uses it. Packs already sent are unchanged." });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "That didn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const chip = "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[12px] leading-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed disabled:opacity-60";
  const problem = bodyError ?? (subject.trim() ? null : "Give the email a subject.") ?? (valid ? null : "Check the subject and body.");

  return (
    <>
      {saveError && <Callout tone="error" title={saveError} />}
      {ro && <ReadOnlyNotice what="the welcome pack" />}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-5">
          <SettingsCard
            title="The four that always go"
            sub="These cannot be removed from the email."
            action={<CardFact>{changedLine(view.updatedAt, view.updatedBy, "Not changed yet — this is the Insurvas wording.")}</CardFact>}
          >
            <ul className="m-0 flex list-none flex-col p-0">
              {LOCKED.map((t) => {
                const gone = missing.includes(t.token);
                return (
                  <li key={t.token} className="flex items-center gap-3 border-t border-[var(--border)] py-2.5 first:border-t-0 first:pt-0">
                    <span className="text-[var(--muted)]"><LockIcon /></span>
                    <span className="min-w-0 flex-1" title={WHY[t.token]}>
                      <span className="block text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{t.label}</span>
                      <span className={cn("block font-mono text-[12px] leading-[1.5]", gone ? "text-[var(--error-ink)]" : "text-[var(--muted)]")}>{t.token}{gone ? " — missing from the body" : ""}</span>
                    </span>
                    {gone && !ro && <Button type="button" variant="outline" size="sm" onClick={() => insert(t.token)}>Put it back</Button>}
                  </li>
                );
              })}
            </ul>
          </SettingsCard>

          <SettingsCard title="Everything else" sub="The wording around the four is yours.">
            <div className="flex flex-col gap-4">
              <Field label="Subject" htmlFor="wp-subject" required>
                <input id="wp-subject" className={control} value={subject} disabled={ro} onChange={(e) => setSubject(e.target.value)} />
              </Field>
              <Field label="Body" htmlFor="wp-body" required error={bodyError} hint="A blank line starts a new paragraph.">
                <textarea
                  id="wp-body"
                  ref={bodyRef}
                  rows={14}
                  disabled={ro}
                  aria-invalid={missing.length > 0 || undefined}
                  className={cn(control, "h-auto py-2 leading-[1.6]", missing.length > 0 && "border-[var(--error)]")}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </Field>
              {unknown.length > 0 && <p role="alert" className="m-0 text-[12px] leading-[1.5] text-[var(--warning-ink)]">{unknown.join(", ")} {unknown.length === 1 ? "isn't a token" : "aren't tokens"} the pack knows — the client would see {unknown.length === 1 ? "it" : "them"} as written.</p>}
              {!ro && (
                <div className="flex flex-col gap-2">
                  <span className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">Insert a token</span>
                  <div className="flex flex-wrap gap-2">
                    {OPTIONAL.map((t) => (
                      <button key={t.token} type="button" onClick={() => insert(t.token)} title={`${t.label} — inserted at the cursor`} className={cn(chip, "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--body)] hover:bg-[var(--surface-alt)]")}>
                        {t.token}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {view.canEdit && (subject !== DEFAULT_WELCOME_PACK.subject || body !== DEFAULT_WELCOME_PACK.body) && (
                <div>
                  <Button type="button" variant="outline" onClick={() => { setSubject(DEFAULT_WELCOME_PACK.subject); setBody(DEFAULT_WELCOME_PACK.body); }}>Start again from the Insurvas wording</Button>
                </div>
              )}
            </div>
          </SettingsCard>
        </div>

        <Preview subject={subject} body={body} me={view.me} />
      </div>

      <SettingsSaveBar visible={view.canEdit && dirty} note="Unsaved changes to the welcome pack. A pack already sent keeps its wording.">
        <DiscardSave saving={saving} problem={problem} onDiscard={() => { setSubject(saved.subject); setBody(saved.body); setSaveError(null); }} onSave={() => { void onSave(); }} />
      </SettingsSaveBar>
    </>
  );
}

export function SalesWelcomePack() {
  const { sample, view, state, load, save } = useSalesSettings();
  const blocked = PanelState({ state, onRetry: load, what: "The welcome pack" });
  return (
    <SettingsStack>
      <SalesPanelTop sample={sample} />
      {blocked ?? (view && <Editor key={view.updatedAt ?? "defaults"} view={view} save={save} />)}
    </SettingsStack>
  );
}
