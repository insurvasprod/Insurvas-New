"use client";

import { useState, type ReactNode } from "react";

import { SettingsCard } from "@/components/app/settings/primitives";
import { API_SCOPES, WEBHOOK_EVENTS } from "@/lib/apiKeys/constants";
import { MAX_TRIES, OFF_AFTER, RETRY_LADDER_MINUTES, SAMPLE_DELIVERY, requestSample, verifySample, type SampleLanguage } from "@/lib/apiKeys/hub";
import { cn } from "@/lib/utils";
import { CodeCard } from "./shared";

/**
 * Settings › Integrations, round 8 option A · Developer docs (board A13): everything a developer needs
 * on one tab — the address, keys, each data type, webhooks and checking our signature — with curl or
 * JavaScript. Every fact here is what the code does (lib/apiKeys, lib/webhooks), not a promise.
 */

export type DocTopic = "address" | "errors" | "policies" | "leads" | "commissions" | "events" | "signature" | "retries";

const INDEX: { group: string; items: { key: DocTopic; label: string }[] }[] = [
  { group: "Start", items: [{ key: "address", label: "Address and keys" }, { key: "errors", label: "Errors and limits" }] },
  { group: "Read", items: [{ key: "policies", label: "Policies" }, { key: "leads", label: "Leads" }, { key: "commissions", label: "Commissions" }] },
  { group: "Webhooks", items: [{ key: "events", label: "Events" }, { key: "signature", label: "Check the signature" }, { key: "retries", label: "Retries" }] },
];

const scopeLabel = (key: string) => API_SCOPES.find((scope) => scope.key === key)?.label ?? key;
const ladder = RETRY_LADDER_MINUTES.map((m) => (m < 60 ? `${m} min` : `${m / 60} h`)).join(", ");

function Section({ title, help, children }: { title: string; help?: ReactNode; children?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-[var(--border)] pt-4 first:border-t-0 first:pt-0">
      <div>
        <h3 className="m-0 text-base font-semibold text-[var(--ink)]">{title}</h3>
        {help && <p className="m-0 mt-1 text-sm text-[var(--body)]">{help}</p>}
      </div>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: { label: string; value: ReactNode; mono?: boolean }[] }) {
  return (
    <dl className="m-0 grid grid-cols-[170px_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-xs text-[var(--muted)]">{row.label}</dt>
          <dd className={cn("m-0 min-w-0 break-words text-[var(--ink)]", row.mono && "font-mono text-xs")}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DeveloperDocs({ origin, topic, onTopic }: { origin: string; topic: DocTopic; onTopic: (topic: DocTopic) => void }) {
  const [language, setLanguage] = useState<SampleLanguage>("js");
  const sample = (path: string) => <CodeCard code={requestSample(language, origin, "YOUR_KEY", path)} language={language} onLanguage={setLanguage} />;

  return (
    <SettingsCard className="flex min-h-0 flex-col p-0 lg:flex-1" bodyClassName="flex min-h-0 flex-1 flex-col md:flex-row">
      <nav aria-label="Developer docs" className="flex shrink-0 flex-row flex-wrap gap-1 border-b border-[var(--border)] p-3 md:w-[200px] md:flex-col md:flex-nowrap md:border-r md:border-b-0">
        {INDEX.map((group) => (
          <div key={group.group} className="flex flex-col gap-0.5">
            <span className="px-2.5 pt-2 pb-1 text-xs font-semibold text-[var(--muted)]">{group.group}</span>
            {group.items.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-current={topic === item.key ? "page" : undefined}
                onClick={() => onTopic(item.key)}
                className={cn("border-0 rounded-[8px] px-2.5 py-1.5 text-left text-sm", topic === item.key ? "bg-[var(--primary-soft)] font-semibold text-[var(--accent-ink)]" : "bg-transparent text-[var(--body)] hover:bg-[var(--surface-alt)]")}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex max-w-[820px] flex-col gap-5 p-4">
          {topic === "address" && (
            <>
              <Section title="Address and keys" help="Every request goes to your Insurvas address with an API key in its Authorization header. A key does only what it was made for; make one under API keys.">
                <Facts rows={[
                  { label: "Address", value: `${origin}/api/v1`, mono: true },
                  { label: "Header", value: "Authorization: Bearer YOUR_KEY", mono: true },
                  { label: "A key looks like", value: "isk_ followed by 43 letters and digits", mono: false },
                  { label: "Shown", value: "Once, when it's made. We keep a fingerprint, never the key." },
                ]} />
                {sample("/api/v1/policies?limit=50")}
              </Section>
              <Section title="What a key can do" help="Pick only what the app needs. There is no full-access key.">
                <Facts rows={API_SCOPES.map((scope) => ({ label: scope.label, value: scope.description }))} />
              </Section>
            </>
          )}
          {topic === "errors" && (
            <Section title="Errors and limits" help="A refused request answers with a code and a sentence; nothing else changes.">
              <Facts rows={[
                { label: "Shape", value: '{ "error": { "code": "…", "message": "…" } }', mono: true },
                { label: "401 invalid_key", value: "No key, a wrong key, or one that was revoked or has ended." },
                { label: "403", value: "The key can't do this, the agency's plan doesn't include it, or the account is read-only." },
                { label: "429 rate_limited", value: "More than 120 requests a minute on one key. Wait for the Retry-After seconds." },
                { label: "400 invalid_cursor", value: "Send back the next_cursor you were given, unchanged." },
                { label: "Pages", value: "limit is 1 to 100 (50 if left out). Each answer has data and next_cursor; pass cursor=… for the next page." },
                { label: "Never sent", value: "A Social Security number, bank details or a card number. A field that would carry one is taken out." },
              ]} />
            </Section>
          )}
          {topic === "policies" && (
            <Section title="Policies" help={`GET /api/v1/policies · needs “${scopeLabel("policies:read")}”. Your book, carrier by carrier, policy by policy.`}>
              <Facts rows={[{ label: "Each policy", value: "policy_number, carrier (id and name), status, effective_date, issue_date, paid_to_date, termination_date, premium_cents, premium_mode, annualised_premium_cents, face_amount_cents, product_code, as_of" }, { label: "Money", value: "In cents: 4820 is $48.20." }]} />
              {sample("/api/v1/policies?limit=50")}
            </Section>
          )}
          {topic === "leads" && (
            <Section title="Leads" help={`GET /api/v1/leads · needs “${scopeLabel("leads:read")}”. POST /api/v1/leads · needs “${scopeLabel("leads:write")}”; lead vendors post through Lead posting instead.`}>
              <Facts rows={[{ label: "Each lead", value: "id, created_at, updated_at, product_line, pipeline_id, stage_id, campaign_id, and fields: name, phone, email, state and the like" }, { label: "Order", value: "Newest first." }]} />
              {sample("/api/v1/leads?limit=50")}
            </Section>
          )}
          {topic === "commissions" && (
            <Section title="Commissions" help={`GET /api/v1/commissions · needs “${scopeLabel("commissions:read")}”. Commission lines from carrier statements, newest first; since=YYYY-MM-DD limits by date.`}>
              <Facts rows={[{ label: "Each line", value: "entry_type, policy_number, carrier, transaction_date, statement_date, rate_bp, commissionable_premium_cents, months_advanced, amount_cents" }, { label: "Money", value: "In cents." }]} />
              {sample("/api/v1/commissions?limit=50")}
            </Section>
          )}
          {topic === "events" && (
            <>
              <Section title="Events" help="A webhook sends one signed POST per event, the moment it happens.">
                <Facts rows={WEBHOOK_EVENTS.map((event) => ({ label: event.label, value: <><code className="font-mono text-xs">{event.key}</code> · {event.description}</> }))} />
                <Facts rows={[
                  { label: "Headers", value: "Insurvas-Signature, Insurvas-Event (the event's name), Insurvas-Delivery and Insurvas-Event-Id", mono: false },
                  { label: "Same event twice?", value: "Possible after a retry. The id in the body is the same; skip one you have seen." },
                ]} />
              </Section>
              <Section title="What a delivery looks like" help="Policy issued. Figures and identifiers only; never a Social Security number, bank details or health answers.">
                <CodeCard code={SAMPLE_DELIVERY} />
              </Section>
            </>
          )}
          {topic === "signature" && (
            <Section title="Check the signature" help="Every delivery carries a timestamp and a signature made with your webhook's signing secret. Refuse anything older than 5 minutes or with a signature that doesn't match.">
              <Facts rows={[
                { label: "Header", value: "Insurvas-Signature: t=1731424860,v1=5f3c…", mono: true },
                { label: "Signed text", value: "the timestamp, a dot, then the raw body" },
                { label: "Method", value: "HMAC with SHA-256, using the signing secret, in hex" },
              ]} />
              <CodeCard code={verifySample(language)} language={language} onLanguage={setLanguage} />
            </Section>
          )}
          {topic === "retries" && (
            <Section title="Retries" help="Answer with any 2xx within 10 seconds and the delivery is done. Anything else, or no answer, and we try again.">
              <Facts rows={[
                { label: "Tries", value: `${MAX_TRIES} per event, waiting ${ladder} between them (about 9 hours in all).` },
                { label: "Redirects", value: "Not followed: a 3xx counts as a failure." },
                { label: "Failing", value: "When an event uses up its tries, the webhook shows Failing; new events still go." },
                { label: "Turned off", value: `After ${OFF_AFTER} failures in a row we turn it off, stop the waiting events and tell the agency's owners. Turning it back on can send the missed events again, in order.` },
              ]} />
            </Section>
          )}
        </div>
      </div>
    </SettingsCard>
  );
}
