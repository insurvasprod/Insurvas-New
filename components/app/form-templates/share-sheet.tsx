"use client";

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Segmented } from "@/components/ui/view-tabs";
import { SectionLoading } from "@/components/ui/page-states";
import { Field, Switch, control } from "@/components/app/settings/primitives";
import { notify } from "@/lib/notify";
import { FormStatusLine, NeedsUpdate } from "@/components/app/form-templates/status-line";

type Audience = "public" | "partners" | "agents";
type Share = { slug: string; audience: Audience; source_label: string; is_active: boolean };
type Tab = "link" | "embed" | "qr";
type Embed = "inline" | "popup" | "page";

const AUDIENCE: Array<{ key: Audience; label: string }> = [{ key: "public", label: "Anyone with the link" }, { key: "partners", label: "Signed-in partners" }, { key: "agents", label: "Your agents" }];

function Copyable({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5">
      <code className="min-w-0 flex-1 truncate font-mono text-sm text-[var(--ink)]">{value}</code>
      <Button type="button" variant="outline" size="sm" onClick={() => { void navigator.clipboard?.writeText(value); notify.done(`${label} copied`); }}>Copy</Button>
    </div>
  );
}

function download(name: string, href: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.click();
}

/**
 * Share this form (board A7): one link, who can open it, embed code for the agency's website, a QR for
 * mailers, and the lead source its leads carry. Share is the page's one gold button. The link always
 * serves the live version, never the draft. Needs 20261112200000.
 */
export function ShareSheet({ copyId, formName, liveVersion, available, onClose }: { copyId: string; formName: string; liveVersion: number; available: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("link");
  const [share, setShare] = useState<Share | null>(null);
  const [state, setState] = useState<"loading" | "pending" | "ready" | "failed">(available ? "loading" : "pending");
  const [audience, setAudience] = useState<Audience>("public");
  const [source, setSource] = useState(`Website · ${formName}`.slice(0, 80));
  const [active, setActive] = useState(true);
  const [embed, setEmbed] = useState<Embed>("inline");
  const [qr, setQr] = useState<{ png: string; svg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!available) { setState("pending"); return; }
    const response = await fetch(`/api/app/templates/${copyId}/share`, { cache: "no-store" }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    if (response?.status === 503) { setState("pending"); return; }
    if (!response?.ok) { setState("failed"); return; }
    setShare(body.share);
    if (body.share) { setAudience(body.share.audience); setSource(body.share.source_label); setActive(body.share.is_active); }
    setState("ready");
  }, [copyId, available]);
  // External state into the sheet.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const link = share ? `${origin}/f/${share.slug}` : null;
  useEffect(() => {
    if (!link) return;
    let live = true;
    const mailer = `${link}?source=mailer`;
    void Promise.all([QRCode.toDataURL(mailer, { margin: 1, width: 512 }), QRCode.toString(mailer, { type: "svg", margin: 1 })]).then(([png, svg]) => { if (live) setQr({ png, svg }); });
    return () => { live = false; };
  }, [link]);

  async function save() {
    setSaving(true);
    const response = await fetch(`/api/app/templates/${copyId}/share`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audience, source_label: source, is_active: active }) }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    setSaving(false);
    if (!response?.ok) { notify.block(body?.error ?? "The link didn’t save"); return; }
    setShare(body.share);
    notify.done(share ? "Link saved" : "Link made");
  }

  const code = !share ? "" : embed === "inline"
    ? `<div data-insurvas-form="${share.slug}"></div>\n<script async src="${origin}/embed.js"></script>`
    : embed === "popup"
      ? `<a href="${link}" data-insurvas-popup="${share.slug}">Get a quote</a>\n<script async src="${origin}/embed.js"></script>`
      : `<iframe src="${link}" style="width:100%;height:100vh;border:0" title="${formName}"></iframe>`;

  return (
    <Sheet
      title="Share this form"
      status={state === "pending" ? <NeedsUpdate /> : undefined}
      onClose={onClose}
      className="lg:w-[600px]"
      footer={<><span className="flex-1" />{state === "ready" && <Button type="button" variant="outline" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : share ? "Save link" : "Make the link"}</Button>}<Button type="button" onClick={onClose}>Done</Button></>}
    >
      <FormStatusLine tone={state === "pending" ? "warning" : "neutral"}>
        {state === "pending" ? "Share links save once Insurvas applies its database update." : `Link shares the live version ${liveVersion} · your draft is not public`}
      </FormStatusLine>
      <Segmented label="Share" value={tab} onChange={setTab} options={[{ key: "link", label: "Link" }, { key: "embed", label: "Embed" }, { key: "qr", label: "QR code" }]} />
      {state === "loading" && <SectionLoading rows={3} columns={1} label="Reading the link" />}
      {state === "failed" && <FormStatusLine tone="danger" action={<Button type="button" variant="ghost" size="sm" onClick={() => void load()}>Try again</Button>}>The link didn’t load.</FormStatusLine>}
      {(state === "ready" || state === "pending") && tab === "link" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-label text-[var(--body)]">Form link</span>
            {link ? <Copyable value={link} label="Link" /> : <p className="m-0 text-sm text-[var(--body)]">{state === "pending" ? "Made once the update is applied." : "Make the link to get its address. It names your agency and the product, never an id."}</p>}
            {link && <span className="text-xs text-[var(--muted)]">The public page that opens this link is the next part of this build; until it is live the link reserves the name.</span>}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-label text-[var(--body)]">Who can open it</span>
            <Segmented label="Who can open it" value={audience} onChange={setAudience} options={AUDIENCE} disabled={state !== "ready"} />
            <span className="text-xs text-[var(--muted)]">Anyone-with-the-link leads give consent on the last page and are checked against your Never call list.</span>
          </div>
          <Field label="Lead source for this link" htmlFor="share-source" hint="Leads from this link carry it, so they show up apart in Results.">
            <input id="share-source" className={control} maxLength={80} value={source} disabled={state !== "ready"} onChange={(event) => setSource(event.target.value)} />
          </Field>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="share-active" className="text-sm text-[var(--body)]">The link is on</label>
            <Switch id="share-active" checked={active} disabled={state !== "ready"} onChange={setActive} />
          </div>
        </div>
      )}
      {(state === "ready" || state === "pending") && tab === "embed" && (
        <div className="flex flex-col gap-3">
          <span className="text-label text-[var(--body)]">Embed on your website</span>
          <Segmented label="Embed as" value={embed} onChange={setEmbed} options={[{ key: "inline", label: "In the page" }, { key: "popup", label: "Pop-up button" }, { key: "page", label: "Full page" }]} />
          {share ? (
            <>
              <pre className="m-0 overflow-x-auto rounded-[8px] bg-[var(--surface-alt)] p-3 font-mono text-xs leading-[1.6] text-[var(--ink)]">{code}</pre>
              <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => { void navigator.clipboard?.writeText(code); notify.done("Embed code copied"); }}>Copy the code</Button>
              <span className="text-xs text-[var(--muted)]">The code works once the public form page is live, the next part of this build.</span>
            </>
          ) : <p className="m-0 text-sm text-[var(--body)]">Make the link first; the code uses it.</p>}
        </div>
      )}
      {(state === "ready" || state === "pending") && tab === "qr" && (
        <div className="flex flex-wrap items-start gap-4">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr.png} alt={`QR code for ${formName}`} width={144} height={144} className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)]" />
          ) : <div aria-hidden="true" className="size-36 rounded-[8px] border border-dashed border-[var(--border-strong)]" />}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <strong className="text-sm font-semibold text-[var(--ink)]">QR code for mailers</strong>
            <span className="text-sm text-[var(--muted)]">Opens the same link with source = mailer, so mailer leads show up apart in Results.</span>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" disabled={!qr} onClick={() => qr && download(`${formName}.png`, qr.png)}>Download PNG</Button>
              <Button type="button" variant="outline" size="sm" disabled={!qr} onClick={() => qr && download(`${formName}.svg`, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.svg)}`)}>Download SVG</Button>
            </div>
          </div>
        </div>
      )}
    </Sheet>
  );
}
