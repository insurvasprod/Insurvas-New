"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionLoading } from "@/components/ui/page-states";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

import { ProfileRow, RowPanel } from "../row";
import { call, FormError, LoadFailed, post, TWO_FACTOR_UNAVAILABLE, type TwoFactor, type When } from "./shared";

/**
 * Two-step sign-in (two-factor): after the password, the 6 numbers from an authenticator app. One row
 * that says where things stand, with the next step under it — closed until the reader starts it:
 *
 *   Set it up → step 1 scan, step 2 type the numbers → step 3 keep the spare codes → on.
 *
 * Safety (critique, 2026-10-27): new spare codes and turning it off each ask for a current code;
 * "I've kept them safe" waits until the codes were copied or downloaded; a wrong code says why.
 */
type Managing = "disable" | "recovery_codes";

export function TwoFactorSection({ email, twoFactor, unavailable, failed, onRetry, onChanged, promptTwoFactor, when }: {
  email: string;
  twoFactor: TwoFactor | null;
  /** The server cannot run two-factor here yet (its 503). */
  unavailable: boolean;
  failed: boolean;
  onRetry: () => void;
  /** Reloads the status after a change. */
  onChanged: () => void;
  promptTwoFactor: boolean;
  when: When;
}) {
  const router = useRouter();
  const [enrolment, setEnrolment] = useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [kept, setKept] = useState(false);
  const [justOn, setJustOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [managing, setManaging] = useState<Managing | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyFallback, setCopyFallback] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const setUpButton = useRef<HTMLButtonElement>(null);
  const autoStarted = useRef(false);

  async function twoFactorAction(body: Record<string, string>) {
    setBusy(true);
    setError(null);
    const result = await call<{ qr?: string; secret?: string; recoveryCodes?: string[] }>("/api/app/profile/two-factor", post(body));
    setBusy(false);
    // 503 is the server saying two-factor cannot run here yet (its table missing, or no key to seal
    // secrets with). That wording was for us, not the reader (redesign, 2026-10-24).
    if (!result.ok) { setError(result.status === 503 ? TWO_FACTOR_UNAVAILABLE : result.error); return null; }
    return result.data;
  }

  const startEnrolment = () => {
    setJustOn(false);
    void twoFactorAction({ action: "start" }).then((d) => { if (d?.qr && d.secret) { setEnrolment({ qr: d.qr, secret: d.secret }); setCode(""); } });
  };

  // Sent here by sign-in with ?two_factor=required (the role needs it): bring the two-step row into
  // view and put the focus on "Set it up", once, so the reader does not have to find it. The QR code
  // and its key stay closed until they choose to start (owner, 2026-10-27; it used to open by itself).
  useEffect(() => {
    if (!promptTwoFactor || autoStarted.current || !twoFactor || twoFactor.enabled || enrolment || codes) return;
    autoStarted.current = true;
    row.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    setUpButton.current?.focus({ preventScroll: true });
  }, [promptTwoFactor, twoFactor, enrolment, codes]);

  const copyCodes = (list: string[]) => {
    setCopyFallback(false);
    const write = navigator.clipboard?.writeText(list.join("\n"));
    if (!write) { setCopyFallback(true); return; }
    void write.then(() => { setKept(true); notify.done("Spare codes copied"); }, () => setCopyFallback(true));
  };

  // The codes as a plain text file, made in the browser: nothing is sent anywhere to produce it.
  const downloadCodes = (list: string[]) => {
    const blob = new Blob([`Insurvas spare codes for ${email}\nEach code signs you in once, instead of the 6 numbers from your app.\n\n${list.join("\n")}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "insurvas-spare-codes.txt";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setKept(true);
  };

  function stopManaging() {
    setManaging(null);
    setCode("");
    setError(null);
  }

  const required = Boolean(twoFactor?.required);
  const offAndNeeded = Boolean(twoFactor && !twoFactor.enabled && required);

  // ── where it stands, in the row ─────────────────────────────────────────────────────────────────
  const status = !twoFactor && unavailable ? <p className="m-0 text-sm text-[var(--muted)]">{TWO_FACTOR_UNAVAILABLE}</p>
    : !twoFactor && failed ? <LoadFailed what="your two-step sign-in" onRetry={onRetry} />
    : !twoFactor ? <SectionLoading rows={1} columns={2} label="Checking two-step sign-in" />
    : (
      <div className="flex flex-col gap-0.5">
        <p className={cn("m-0 text-sm font-semibold", twoFactor.enabled ? "text-[var(--success-ink)]" : required ? "text-[var(--warning-ink)]" : "text-[var(--ink)]")}>
          {twoFactor.enabled
            ? `On since ${when(twoFactor.enabledAt ?? "")} · ${twoFactor.recoveryCodesLeft} spare code${twoFactor.recoveryCodesLeft === 1 ? "" : "s"} left`
            : required ? "Off · your role needs it" : "Off"}
        </p>
        <p className="m-0 text-sm leading-[1.45] text-[var(--body)]">After your password, you type 6 numbers from an app on your phone. Someone who steals your password still can&apos;t get in.</p>
      </div>
    );

  const actions = !twoFactor || codes || enrolment || managing ? undefined
    : twoFactor.enabled ? (
      <>
        <Button type="button" variant="outline" onClick={() => { setJustOn(false); setManaging("recovery_codes"); setCode(""); }}>New spare codes</Button>
        <Button type="button" variant="ghost" className="text-[var(--error-ink)] hover:text-[var(--error-ink)]" onClick={() => { setJustOn(false); setManaging("disable"); setCode(""); }}>Turn off</Button>
      </>
    ) : <Button ref={setUpButton} type="button" variant={required ? "default" : "outline"} disabled={busy} onClick={startEnrolment}>{busy ? "Starting…" : "Set it up"}</Button>;

  // ── the next step, under the row ────────────────────────────────────────────────────────────────
  let below: React.ReactNode = null;
  if (twoFactor && enrolment) {
    below = (
      <RowPanel className="bg-[var(--surface)] ring-1 ring-[var(--border)]">
        <form className="flex flex-wrap items-start gap-5" onSubmit={(event) => {
          event.preventDefault();
          void twoFactorAction({ action: "confirm", code }).then((d) => { if (d?.recoveryCodes) { setCodes(d.recoveryCodes); setKept(false); setEnrolment(null); setCode(""); onChanged(); } });
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL made on the server */}
          <img src={enrolment.qr} alt="Square code to scan with your phone" width={148} height={148} className="shrink-0 rounded-md border border-[var(--border)] bg-white p-1" />
          <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-2.5 text-sm">
            <p className="m-0 text-[var(--body)]"><b className="text-[var(--ink)]">Step 1 of 3 · Scan</b> the square with Google Authenticator, 1Password, Authy or a similar app. Can&apos;t scan? Type this code into the app instead:</p>
            <code className="self-start break-all rounded bg-[var(--surface-alt)] px-2 py-1 font-mono text-xs text-[var(--ink)]">{enrolment.secret}</code>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="security-enrol-code">Step 2 · The 6 numbers your app shows</Label>
              <Input id="security-enrol-code" className={cn("max-w-[180px] tracking-[0.2em]", error && "border-[var(--error)]")} inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} value={code} aria-invalid={Boolean(error)} aria-describedby={error ? "security-enrol-error" : undefined} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            </div>
            {error ? <p id="security-enrol-error" role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error} The numbers change every 30 seconds, so type the newest ones.</p> : null}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy || code.trim().length !== 6}>{busy ? "Checking…" : "Turn it on"}</Button>
              <Button type="button" variant="ghost" onClick={() => { setEnrolment(null); setCode(""); setError(null); }}>Cancel</Button>
            </div>
          </div>
        </form>
      </RowPanel>
    );
  } else if (codes) {
    below = (
      <RowPanel className="bg-[var(--surface)] ring-1 ring-[var(--border)]">
        <p className="m-0 text-sm font-semibold text-[var(--ink)]">Step 3 of 3 · Keep these spare codes. You won&apos;t see them again.</p>
        <p className="m-0 text-xs text-[var(--muted)]">Lost your phone? Each code gets you in once, instead of the 6 numbers.</p>
        <ul className="m-0 grid list-none gap-x-6 gap-y-1 p-0 font-mono text-sm text-[var(--ink)] tabular-nums [grid-template-columns:repeat(auto-fill,minmax(120px,1fr))]">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => copyCodes(codes)}>Copy</Button>
          <Button type="button" variant="outline" onClick={() => downloadCodes(codes)}>Download</Button>
          {/* Waits for Copy or Download. When the clipboard says no, the reader was told to copy them by
              hand, which nothing here can see — so the button wakes then too, or they would be stuck. */}
          <Button type="button" disabled={!kept && !copyFallback} aria-describedby={kept || copyFallback ? undefined : "security-codes-first"} onClick={() => { setCodes(null); setKept(false); setCopyFallback(false); setJustOn(true); notify.done("Two-step sign-in is on"); }}>I&apos;ve kept them safe</Button>
          {!kept && !copyFallback && <span id="security-codes-first" className="text-xs text-[var(--muted)]">Copy or download them first.</span>}
        </div>
        {/* A refused or missing clipboard (an http page, a browser that says no) said nothing before. */}
        {copyFallback ? <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">Could not copy. Download them as a file, or select the codes above and copy them yourself.</p> : null}
      </RowPanel>
    );
  } else if (twoFactor?.enabled && managing) {
    const off = managing === "disable";
    below = (
      <RowPanel>
        <form className="flex flex-col gap-3" onSubmit={(event) => {
          event.preventDefault();
          void twoFactorAction({ action: managing, code }).then((d) => {
            if (!d) return;
            if (d.recoveryCodes) { setCodes(d.recoveryCodes); setKept(false); } else notify.done("Two-step sign-in is off");
            setManaging(null); setCode(""); onChanged(); router.refresh();
          });
        }}>
          <div className="flex max-w-xs flex-col gap-1.5">
            <Label htmlFor="security-manage-code">{off ? "The 6 numbers your app shows now, or a spare code" : "The 6 numbers your app shows now"}</Label>
            <Input id="security-manage-code" autoComplete="one-time-code" autoFocus maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <p className="m-0 text-xs text-[var(--muted)]">
            {off
              ? `Turning it off makes your account easier to break into.${required ? " Your role needs it on to see Social Security and bank numbers." : ""}`
              : "Your old spare codes stop working and you get new ones."}
          </p>
          <FormError>{error}</FormError>
          <div className="flex gap-2">
            <Button type="submit" variant={off ? "destructive" : "default"} disabled={busy || !code.trim()}>{busy ? "Checking…" : off ? "Turn off two-step sign-in" : "Make new codes"}</Button>
            <Button type="button" variant="ghost" onClick={stopManaging}>Cancel</Button>
          </div>
        </form>
      </RowPanel>
    );
  } else if (twoFactor) {
    const notes = [
      offAndNeeded && <p key="need" role="status" className="m-0 text-sm text-[var(--warning-ink)]">{promptTwoFactor ? "Set this up now. " : ""}Your role needs this. Until it&apos;s on, you can&apos;t see Social Security or bank numbers. Everything else works.</p>,
      justOn && twoFactor.enabled && <p key="done" role="status" className="m-0 rounded-md bg-[var(--success-surface)] px-3 py-2 text-sm font-semibold text-[var(--success-ink)]">Done. Two-step sign-in is on.</p>,
      twoFactor.enabled && !twoFactor.sessionVerified && <p key="stale" role="status" className="m-0 text-sm text-[var(--body)]">This sign-in started before two-step sign-in was on. Sign in again with your 6 numbers to see sensitive details here.</p>,
      !twoFactor.enabled && error && <FormError key="err">{error}</FormError>,
    ].filter(Boolean);
    below = notes.length ? <div className="flex flex-col gap-2">{notes}</div> : null;
  }

  return (
    <ProfileRow id="security-two-factor" rowRef={row} label="Two-step sign-in" top tone={offAndNeeded && !enrolment && !codes ? "warn" : undefined} actions={actions} below={below}>
      <div className="sm:pt-2">{status}</div>
    </ProfileRow>
  );
}
