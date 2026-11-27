import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";

import { Icon } from "@/components/icon";
import { isoToUsDate, maskUsDate, usDateToIso } from "@/components/leads/logic";
import { SegControl, Sheet, SelectField } from "@/components/leads/sheets";
import { Between, Button, Card, Empty, F, Failed, Field, Header, Loading, Row, Screen, Toggle } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

import { consentField, consentProblem, consentShort, firstWord, formFields, formLayout, missingRequired, nowMs, sendLabel, sendMode, stateCode, STATE_NAMES, submissionId, transferFacts, withDefaults, type ConsentKind, type FormRow } from "./logic";
import { usePartnerSession } from "./session";
import type { FormAnswer, PartnerLeadDetail, PartnerProduct, TemplateField } from "./types";

/**
 * Board K2 · Send a lead, and K2b · Live transfer.
 *
 * A call centre (publisher) fills the agency's own partner template for the product (GET
 * /api/partner/forms/[product]) and sends it to /api/partner/leads; a marketing or affiliate partner sends
 * the short referral (name, phone, state, product) to /api/partner/referrals. Both routes screen the
 * number, check the partner's markets and products, refuse a paused partner, and need the partner's
 * consent attestation. The phone never sends that attestation on a tick: it asks for the proof — a
 * TrustedForm / Jornaya certificate, or the recording of a verbal yes — and files it in the template's own
 * consent field when the agency's template has one.
 *
 * The board's layout on a phone: First | Last, Phone, Date of birth | State, Product, the rest of the
 * agency's questions, Consent proof, and the note for the agent last (logic.ts formLayout).
 *
 * Live transfer / Lead only is sent with the lead (`live_transfer`), and a live transfer shows K2b the
 * moment Send is pressed: the caller, the seconds waited, the checks, how many agents are ready, and the
 * moment one claims it (GET /api/partner/leads/[id]?phone=1, read every five seconds while waiting).
 */
type Choice = { field: TemplateField } | null;
type Sent = { leadId: string | null; name: string; at: number; live: boolean; facts: string };

export function PartnerSend() {
  const { me } = usePartnerSession();
  if (!me) return <Screen header={<Header title="Send a lead" />}><Loading rows={4} /></Screen>;
  return sendMode(me.partnerType) === "template" ? <TemplateSend /> : <ReferralSend />;
}

/**
 * The consent proof (board K2: "Consent proof · TrustedForm · 7f3c…a19e", "Or attach the call recording
 * where they agreed."). A certificate shows in its short form once entered; the line under it switches
 * to naming the recording of a verbal yes, and back.
 */
function ConsentProof({ kind, onKind, value, onValue, error }: { kind: ConsentKind; onKind: (k: ConsentKind) => void; value: string; onValue: (v: string) => void; error: string | null }) {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  const short = kind === "certificate" && value && !consentProblem("certificate", value) ? consentShort(value) : null;
  return (
    <View style={{ gap: 6 }}>
      <Field testID="consent-proof" label={kind === "certificate" ? "Consent proof" : "Consent proof · recorded verbal"} leadIcon="shield" value={!focused && short ? short : value} onChangeText={onValue}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} autoCapitalize="none" autoCorrect={false}
        placeholder={kind === "certificate" ? "TrustedForm URL or LeadiD" : "Recording ID or file name"} error={error} />
      {error ? null : (
        <Text testID="consent-switch" accessibilityRole="button" onPress={() => onKind(kind === "certificate" ? "verbal" : "certificate")} style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>
          {kind === "certificate" ? "Or attach the call recording where they agreed." : "Or paste the TrustedForm certificate instead."}
        </Text>
      )}
    </View>
  );
}

function TemplateSend() {
  const p = usePalette();
  const { api, me } = usePartnerSession();
  const [mode, setMode] = useState<"live" | "lead">("lead");
  const products = useLoad(() => api<{ products: PartnerProduct[] }>("/api/partner/products").then((a) => a.products.filter((x) => x.approved !== false)), []);
  const [chosen, setChosen] = useState<string | null>(null);
  const product = chosen ?? products.data?.[0]?.code ?? null;
  const form = useLoad(() => (product ? api<FormAnswer>(`/api/partner/forms/${product}`) : Promise.resolve(null)), [product]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [kind, setKind] = useState<ConsentKind>("certificate");
  const [proof, setProof] = useState("");
  const [picking, setPicking] = useState<Choice>(null);
  const [productPicker, setProductPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryKey, setRetryKey] = useState(() => submissionId());
  const [sent, setSent] = useState<Sent | null>(null);
  const agency = me?.agencyName ?? "the agency";

  const header = (
    <Header title={sendLabel("publisher")} actions={[{ icon: "history", label: "What you sent", onPress: () => router.push("/partner/pipeline" as never) }]}
      belowFull={<View style={{ paddingHorizontal: 16, paddingBottom: 10 }}><SegControl items={[{ key: "live", label: "Live transfer" }, { key: "lead", label: "Lead only" }]} value={mode} onChange={(k) => setMode(k as "live" | "lead")} /></View>} />
  );

  if (sent) return <Screen header={header}><SentCard sent={sent} agency={agency} onAgain={() => { setSent(null); setValues({}); setProof(""); setRetryKey(submissionId()); }} /></Screen>;
  if (products.loading && !products.data) return <Screen header={header}><Loading rows={5} /></Screen>;
  if (products.error && !products.data) return <Screen header={header}><Failed message={products.error} onRetry={products.refresh} what="your products" /></Screen>;
  if (!products.data?.length) return <Screen header={header}><Empty icon="package" title="No products to send yet" body="The agency approves the products you can send. Ask them to add one." /></Screen>;

  const fields = form.data ? formFields(form.data.template.template.fields) : [];
  const layout = formLayout(fields);
  const consentKey = form.data ? consentField(form.data.template.template.fields)?.field_key ?? null : null;
  const set = (key: string, v: unknown) => { setValues((s) => ({ ...s, [key]: v })); setError(null); };
  const productName = products.data.find((x) => x.code === product)?.name ?? product ?? "";

  const submit = async () => {
    if (!product || !form.data) return;
    const missing = missingRequired(fields, values);
    if (missing.length) { setError(`Fill in ${missing.map((f) => f.label).slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}.`); return; }
    const problem = consentProblem(kind, proof);
    setProofError(problem);
    if (problem) return;
    const stateField = fields.find((f) => /state/i.test(f.field_key) && typeof values[f.field_key] === "string");
    const out = { ...withDefaults(fields, values), ...(consentKey ? { [consentKey]: proof.trim() } : {}) };
    const live = mode === "live";
    const name = [values.first_name, values.last_name].filter((x) => typeof x === "string" && x.trim()).join(" ") || String(values.full_name ?? "") || "The lead";
    const facts = transferFacts(values, productName);
    setBusy(true);
    setError(null);
    // K2b shows the moment a live transfer starts; it fills in as the server answers.
    const startedAt = nowMs();
    if (live) setSent({ leadId: null, name, at: startedAt, live, facts });
    try {
      const r = await api<{ lead: { id: string } }>("/api/partner/leads", { method: "POST", body: { product_code: product, values: out, submission_id: retryKey, consent_attested: true, live_transfer: live, ...(stateField ? { carrier_state: stateCode(String(values[stateField.field_key])) ?? undefined } : {}) } });
      setSent({ leadId: r.lead.id, name, at: startedAt, live, facts });
    } catch (e) {
      setSent(null);
      setError(e instanceof ApiError ? e.message : "This could not be sent. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const input = (f: TemplateField) => <TemplateInput key={f.field_key} field={f} value={values[f.field_key]} onChange={(v) => set(f.field_key, v)} onPick={() => setPicking({ field: f })} />;
  const draw = (row: FormRow) => row.kind === "pair"
    ? <View key={`${row.left.field_key}|${row.right.field_key}`} style={{ flexDirection: "row", gap: 10 }}><View style={{ flex: 1, minWidth: 0 }}>{input(row.left)}</View><View style={{ flex: 1, minWidth: 0 }}>{input(row.right)}</View></View>
    : input(row.field);

  return (
    <View style={{ flex: 1 }}>
      <Screen header={header} footer={<Button testID="send-submit" icon="send" write label={`Send to ${agency}`} onPress={() => void submit()} busy={busy} disabled={!form.data} />}>
        <View style={{ paddingHorizontal: 16, gap: 12 }}>
          {form.loading && !form.data ? <Loading rows={3} /> : form.error && !form.data ? <Failed message={form.error} onRetry={form.refresh} what="the form" /> : layout.top.map(draw)}
          <SelectField testID="send-product" label="Product" value={productName} onPress={() => setProductPicker(true)} />
          {form.data ? layout.rest.map(draw) : null}
          <ConsentProof kind={kind} onKind={(k) => { setKind(k); setProofError(null); }} value={proof} onValue={(v) => { setProof(v); setProofError(null); }} error={proofError} />
          {form.data ? layout.notes.map(draw) : null}
          {error ? <Text accessibilityRole="alert" style={{ fontFamily: F.r, fontSize: 13.5, color: p.bad }}>{error}</Text> : null}
        </View>
      </Screen>
      <PickSheet title="Product" open={productPicker} onClose={() => setProductPicker(false)} options={products.data.map((x) => ({ key: x.code, label: x.name }))} value={product} onPick={(k) => { setChosen(k); setValues({}); setProductPicker(false); }} />
      <PickSheet title={picking?.field.label ?? ""} open={Boolean(picking)} onClose={() => setPicking(null)} options={(picking?.field.options ?? []).map((o) => ({ key: o, label: o }))} value={picking ? String(values[picking.field.field_key] ?? "") : null}
        onPick={(k) => { if (picking) set(picking.field.field_key, k); setPicking(null); }} />
    </View>
  );
}

/** One question of the agency's template, as the kit draws a field. */
function TemplateInput({ field, value, onChange, onPick }: { field: TemplateField; value: unknown; onChange: (v: unknown) => void; onPick: () => void }) {
  const p = usePalette();
  const label = field.is_required ? field.label : `${field.label} (optional)`;
  if (field.type === "single_select") return <SelectField testID={`field-${field.field_key}`} label={label} value={typeof value === "string" && value ? value : null} placeholder="Choose…" onPress={onPick} />;
  if (field.type === "boolean") {
    return (
      <Between style={{ paddingVertical: 6 }}>
        <Text style={{ flex: 1, fontFamily: F.r, fontSize: 15, color: p.ink }}>{label}</Text>
        <Toggle label={field.label} value={value === true} onChange={onChange} />
      </Between>
    );
  }
  if (field.type === "multi_select") {
    const list = Array.isArray(value) ? (value as string[]) : [];
    return (
      <View style={{ gap: 6 }}>
        <Text style={{ fontFamily: F.m, fontSize: 13.5, color: p.muted }}>{label}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {field.options.map((o) => {
            const on = list.includes(o);
            return (
              <Pressable key={o} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => onChange(on ? list.filter((x) => x !== o) : [...list, o])}
                style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 9, borderWidth: 1, borderColor: on ? "transparent" : p.line2, backgroundColor: on ? p.greenSoft : "transparent" }}>
                {on ? <Icon name="check" size={14} color={p.greenInk} /> : null}
                <Text style={{ fontFamily: on ? F.s : F.m, fontSize: 14, color: on ? p.greenInk : p.body }}>{o}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }
  // Dates are typed and shown as MM/DD/YYYY (slashes come by themselves); the form keeps the ISO day once it is real.
  if (field.type === "date") {
    return (
      <Field testID={`field-${field.field_key}`} label={label} value={isoToUsDate(value)} onChangeText={(t) => { const masked = maskUsDate(t); onChange(usDateToIso(masked) ?? masked); }}
        keyboardType="number-pad" placeholder="MM/DD/YYYY" hint={field.help_text ?? undefined} />
    );
  }
  const keyboard = field.type === "phone" ? "phone-pad" : field.type === "email" ? "email-address" : field.type === "number" || field.type === "currency" || field.type === "ssn" || field.type === "bank_routing" || field.type === "bank_account" ? "number-pad" : "default";
  return (
    <Field testID={`field-${field.field_key}`} label={label} value={typeof value === "string" ? value : value === undefined || value === null ? "" : String(value)} onChangeText={onChange}
      keyboardType={keyboard} leadIcon={field.type === "phone" ? "phone" : undefined}      multiline={field.type === "long_text"} secureTextEntry={field.type === "ssn"} autoCapitalize={field.type === "email" ? "none" : "sentences"} hint={field.help_text ?? undefined} />
  );
}

/** A list of choices in the kit's sheet. */
function PickSheet({ title, open, onClose, options, value, onPick }: { title: string; open: boolean; onClose: () => void; options: { key: string; label: string }[]; value: string | null; onPick: (key: string) => void }) {
  return (
    <Sheet visible={open} title={title} onClose={onClose}>
      {options.map((o, i) => <Row key={o.key} first={i === 0} title={o.label} selected={o.key === value} onPress={() => onPick(o.key)} chevron={false} />)}
    </Sheet>
  );
}


/**
 * K2b: the transfer and its steps — "70 · AL · final expense", the seconds it has waited, "Checks passed ·
 * consent proof attached", "Waiting for an agent to claim · 4 ready" — and the moment an agent claims it,
 * by first name (GET /api/partner/leads/[id]?phone=1, read every five seconds while waiting). Until the
 * server has answered the send, the first two steps wait too. A lead-only send shows the same card
 * without the wait.
 *
 * The board's "Cancel transfer" is not drawn: no partner route can take a transfer back out of the
 * agency's queue yet.
 */
function SentCard({ sent, agency, onAgain }: { sent: Sent; agency: string; onAgain: () => void }) {
  const p = usePalette();
  const { api } = usePartnerSession();
  const [now, setNow] = useState(() => Date.now());
  // Read every five seconds while the transfer waits; once an agent has claimed it nothing more will change here,
  // so the reading stops (K2b).
  const [settled, setSettled] = useState(false);
  const lead = useLoad(
    () => (sent.leadId
      ? api<PartnerLeadDetail>(`/api/partner/leads/${sent.leadId}?phone=1`).then((d) => { if (d.timeline.some((e) => e.type === "claimed")) setSettled(true); return d; })
      : Promise.resolve(null)),
    [sent.leadId], { every: sent.live && sent.leadId && !settled ? 5_000 : undefined });
  const claim = lead.data?.timeline.find((e) => e.type === "claimed") ?? null;
  const claimer = lead.data?.live?.claimedBy ?? (claim?.detail ? firstWord(claim.detail) : null);
  useEffect(() => {
    if (!sent.live || claim) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [sent.live, claim]);
  const secs = Math.max(0, Math.round(((claim ? new Date(claim.at).getTime() : now) - sent.at) / 1000));
  const accepted = Boolean(sent.leadId);
  const facts = lead.data ? transferFacts(lead.data.values, lead.data.product) || sent.facts : sent.facts;
  const ready = lead.data?.agentsReady;
  const first = firstWord(lead.data?.customer ?? sent.name);
  const step = (done: boolean, text: string, testID?: string) => (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Icon name={done ? "checkC" : "clock"} size={18} color={done ? p.ok : p.faint} />
      <Text style={{ fontFamily: F.r, fontSize: 15, color: done ? p.ink : p.faint, flexShrink: 1 }}>{text}</Text>
    </View>
  );
  return (
    <View style={{ paddingHorizontal: 16, gap: 12 }}>
      <Card>
        <Between>
          <View style={{ flexShrink: 1 }}>
            <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{sent.live ? "Transfer" : "Sent"}</Text>
            <Text testID="sent-name" style={{ fontFamily: F.db, fontSize: 24, color: p.ink }}>{lead.data?.customer ?? sent.name}</Text>
            {facts ? <Text testID="sent-facts" style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{facts}</Text> : null}
          </View>
          {sent.live ? (
            <View style={{ alignItems: "flex-end" }}>
              <Text testID="sent-wait" style={{ fontFamily: F.db, fontSize: 26, color: p.ink, fontVariant: ["tabular-nums"] }}>{`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`}</Text>
              <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{claim ? "claimed" : "waiting"}</Text>
            </View>
          ) : null}
        </Between>
        <View style={{ gap: 10, marginTop: 14 }}>
          {step(accepted, accepted ? `Sent to ${agency}` : `Sending to ${agency}`)}
          {step(accepted, accepted ? "Checks passed · consent proof attached" : "Checking the number and consent proof")}
          {sent.live ? step(Boolean(claim), claim ? `Claimed${claimer ? ` by ${claimer}` : ""}` : `Waiting for an agent to claim${typeof ready === "number" ? ` · ${ready} ready` : ""}`, "sent-claim") : null}
        </View>
      </Card>
      {sent.live ? <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{claim ? `Introduce ${first} and drop off; the call is the agency’s now.` : `Stay on the line. When an agent claims, introduce ${first} and drop off.`}</Text> : null}
      {!sent.live && sent.leadId ? <Button kind="outline" label="Open in your pipeline" icon="kanban" onPress={() => router.push(`/partner/lead/${sent.leadId}` as never)} /> : null}
      {!sent.live || claim ? <Button testID="send-again" kind="plain" label="Send another" onPress={onAgain} /> : null}
    </View>
  );
}

/** Marketing and affiliate partners: the short referral (LA-1.8's portal form), with the consent proof. */
function ReferralSend() {
  const p = usePalette();
  const { api, me } = usePartnerSession();
  const products = useLoad(() => api<{ products: PartnerProduct[] }>("/api/partner/products").then((a) => a.products.filter((x) => x.approved !== false)), []);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [kind, setKind] = useState<ConsentKind>("certificate");
  const [proof, setProof] = useState("");
  const [proofError, setProofError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<"state" | "product" | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryKey, setRetryKey] = useState(() => submissionId());
  const [sent, setSent] = useState<Sent | null>(null);
  const type = me?.partnerType ?? "marketing";
  const header = <Header title={sendLabel(type)} />;
  const agency = me?.agencyName ?? "the agency";

  if (sent) return <Screen header={header}><SentCard sent={sent} agency={agency} onAgain={() => { setSent(null); setName(""); setPhone(""); setProof(""); setRetryKey(submissionId()); }} /></Screen>;
  if (products.loading && !products.data) return <Screen header={header}><Loading rows={4} /></Screen>;
  if (products.error && !products.data) return <Screen header={header}><Failed message={products.error} onRetry={products.refresh} what="your products" /></Screen>;
  if (!products.data?.length) return <Screen header={header}><Empty icon="package" title="Nothing to refer yet" body="The agency approves the products you can send. Ask them to add one." /></Screen>;
  const product = chosen ?? products.data[0].code;

  const submit = async () => {
    if (name.trim().length < 2 || !phone.trim() || !state) { setError("Enter their name, phone and state."); return; }
    const problem = consentProblem(kind, proof);
    setProofError(problem);
    if (problem) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ leadId: string }>("/api/partner/referrals", { method: "POST", body: { product_code: product, values: { full_name: name.trim(), phone: phone.trim(), state, product_interest: product, consent: true }, submission_id: retryKey, consent_attested: true } });
      setSent({ leadId: r.leadId, name: name.trim(), at: Date.now(), live: false, facts: transferFacts({ state }, products.data?.find((x) => x.code === product)?.name ?? null) });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "This could not be sent. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Screen header={header} footer={<Button testID="send-submit" icon="send" write label={`Send to ${agency}`} onPress={() => void submit()} busy={busy} />}>
        <View style={{ paddingHorizontal: 16, gap: 12 }}>
          <Field testID="refer-name" label="Full name" value={name} onChangeText={setName} autoCapitalize="words" />
          <Field testID="refer-phone" label="Phone" leadIcon="phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <SelectField testID="refer-state" label="State" value={state ? STATE_NAMES.find(([c]) => c === state)?.[1] ?? state : null} placeholder="Choose…" onPress={() => setPicker("state")} />
          {products.data.length > 1 ? <SelectField testID="refer-product" label="Product" value={products.data.find((x) => x.code === product)?.name ?? product} onPress={() => setPicker("product")} /> : null}
          <ConsentProof kind={kind} onKind={(k) => { setKind(k); setProofError(null); }} value={proof} onValue={(v) => { setProof(v); setProofError(null); }} error={proofError} />
          {error ? <Text accessibilityRole="alert" style={{ fontFamily: F.r, fontSize: 13.5, color: p.bad }}>{error}</Text> : null}
        </View>
      </Screen>
      <PickSheet title="State" open={picker === "state"} onClose={() => setPicker(null)} options={STATE_NAMES.map(([code, n]) => ({ key: code, label: n }))} value={state} onPick={(k) => { setState(k); setPicker(null); }} />
      <PickSheet title="Product" open={picker === "product"} onClose={() => setPicker(null)} options={products.data.map((x) => ({ key: x.code, label: x.name }))} value={product} onPick={(k) => { setChosen(k); setPicker(null); }} />
    </View>
  );
}
