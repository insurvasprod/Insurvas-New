"use client";

import { useState } from "react";

import { AgentSettingsTabs } from "@/components/app/agent-settings-tabs";
import { Advanced, AutosaveNote, DangerAction, DangerZone, FieldRow, FormSection, FormSections, useAutosave } from "@/components/app/settings/patterns";
import { DraftActions, Field, SettingsSectionHeader, SettingsStack, ToggleRow, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { Segmented, ViewTabs } from "@/components/ui/view-tabs";
import { SETTINGS_SECTIONS, type SettingsSection } from "@/lib/settings/sections";
import { PREVIEW_TEAM, PREVIEW_WORKSPACE } from "@/lib/settings/preview/fixtures";

/**
 * R3 · the Settings content patterns, for approval (tasks/settings-shell-todo.md). Shown inside the real
 * Settings frame, as a menu entry of its own, so each part is judged at the width it will have. Two
 * worked examples (a draft form, an autosaving page with a danger zone) and the rules. Nothing saves.
 */
const PATTERNS: SettingsSection = {
  id: "patterns", label: "Settings patterns", group: "Platform", sort_order: 99, owned_by_module: "R3",
  description: "The parts every Settings page is rebuilt from, with the rule for each. For approval.",
  short: "The parts every Settings page is rebuilt from, with the rule for each. For approval.",
};

const ALL_FEATURES = ["applications", "appointment_vault", "book_of_business", "chargeback_radar", "lead_import", "outbound_dialing", "profit_and_loss", "tcpa_checker"];
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function SettingsPatternsPreview() {
  return (
    <AgentSettingsTabs
      tabs={[...SETTINGS_SECTIONS, PATTERNS]}
      team={PREVIEW_TEAM}
      workspace={PREVIEW_WORKSPACE}
      granted={ALL_FEATURES}
      role="owner"
      renderPanel={(id) => (id === "patterns" ? <PatternsBoard /> : undefined)}
    />
  );
}

type View = "form" | "autosave" | "help" | "rules";

function PatternsBoard() {
  const [view, setView] = useState<View>("form");
  return (
    <SettingsStack>
      <SettingsSectionHeader />
      <ViewTabs
        label="Examples"
        tabs={[{ key: "form", label: "A form that saves together" }, { key: "autosave", label: "Switches that save at once" }, { key: "help", label: "Help behind (i)" }, { key: "rules", label: "The rules" }]}
        value={view}
        onChange={setView}
      />
      {view === "form" && <DraftExample />}
      {view === "autosave" && <AutosaveExample />}
      {view === "help" && <HelpExample />}
      {view === "rules" && <Rules />}
    </SettingsStack>
  );
}

/* ── example 1: a draft form (My profile → Profile, rebuilt) ───────────────────────────────── */

const START = { name: "Umar Masood", email: "umar.m@powerpolicies.com", phone: "(214) 555-0148", timezone: "America/Chicago", npn: "19283746", tx: "2384761", ga: "LIC-9921", greeting: "first" };
type Draft = typeof START;

function DraftExample() {
  const [saved, setSaved] = useState<Draft>(START);
  const [draft, setDraft] = useState<Draft>(START);
  const [saving, setSaving] = useState(false);
  const changed = (Object.keys(draft) as (keyof Draft)[]).filter((key) => draft[key] !== saved[key]).length;
  const set = (key: keyof Draft) => (event: { target: { value: string } }) => setDraft((current) => ({ ...current, [key]: event.target.value }));
  async function save() {
    setSaving(true);
    await pause(700);
    setSaved(draft);
    setSaving(false);
  }
  return (
    <>
      <FormSections>
        <FormSection title="Your details" help="How clients, partners and your team see you. Your email is also how you sign in.">
          <FieldRow>
            <Field label="Full name" htmlFor="p-name"><input id="p-name" className={control} value={draft.name} onChange={set("name")} /></Field>
            <Field label="Phone" htmlFor="p-phone" hint="Shown on quotes and the welcome pack."><input id="p-phone" className={control} value={draft.phone} onChange={set("phone")} /></Field>
          </FieldRow>
          <Field label="Email" htmlFor="p-email" hint="Changing it asks you to confirm the new address."><input id="p-email" className={control} value={draft.email} onChange={set("email")} /></Field>
        </FormSection>

        <FormSection title="Licence" help="Checked before a quote or an application in a state." aside={<StatusChip tone="good">Verified with NIPR</StatusChip>}>
          <Field label="National producer number (NPN)" htmlFor="p-npn"><input id="p-npn" className={control} value={draft.npn} onChange={set("npn")} inputMode="numeric" /></Field>
          <FieldRow>
            <Field label="Texas licence number" htmlFor="p-tx"><input id="p-tx" className={control} value={draft.tx} onChange={set("tx")} /></Field>
            <Field label="Georgia licence number" htmlFor="p-ga"><input id="p-ga" className={control} value={draft.ga} onChange={set("ga")} /></Field>
          </FieldRow>
        </FormSection>

        <FormSection title="How Insurvas talks to you" help="Your own view only; the agency's settings are unchanged.">
          <Field label="Time zone for dates and reminders" htmlFor="p-tz" hint="More than five choices: a dropdown.">
            <select id="p-tz" className={control} value={draft.timezone} onChange={set("timezone")}>
              {["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"].map((zone) => <option key={zone} value={zone}>{zone.replace("America/", "").replace("Pacific/", "").replace("_", " ")}</option>)}
            </select>
          </Field>
          <Advanced hint="Most people never change these">
            <div className="flex flex-col gap-1.5">
              <span className="text-label text-[var(--body)]">How we greet you in emails</span>
              <Segmented label="Greeting" value={draft.greeting} onChange={(greeting) => setDraft((current) => ({ ...current, greeting }))} options={[{ key: "first", label: "First name" }, { key: "full", label: "Full name" }, { key: "none", label: "No name" }]} />
              <span className="text-xs text-[var(--muted)]">Two to five choices: a segmented control.</span>
            </div>
          </Advanced>
        </FormSection>
      </FormSections>

      <LeaveGuard dirty={changed > 0} onDiscard={() => setDraft(saved)} what="your profile" />
      <SettingsSaveBar visible={changed > 0} note={`${changed} unsaved change${changed === 1 ? "" : "s"}`}>
        <DraftActions dirty={changed > 0} saving={saving} onDiscard={() => setDraft(saved)} onSave={() => void save()} />
      </SettingsSaveBar>
    </>
  );
}

/* ── example 2: autosave + danger zone (My profile → Sign-in & security, rebuilt) ──────────── */

function AutosaveExample() {
  const [newDevice, setNewDevice] = useState(true);
  const [weekly, setWeekly] = useState(false);
  const [after, setAfter] = useState<"8h" | "24h" | "7d">("24h");
  const alerts = useAutosave();
  const timeout = useAutosave();
  return (
    <FormSections>
      <FormSection title="Sign-in" help="One row per way in. Each change opens its own short dialog.">
        <SignInRow label="Email" value="umar.m@powerpolicies.com" action="Change email" />
        <SignInRow label="Password" value="Changed 12 days ago" action="Change password" />
        <SignInRow label="Two-step verification" value={<StatusChip tone="good">On · authenticator app</StatusChip>} action="Manage" />
      </FormSection>

      <FormSection title="Security alerts" help="Each switch saves the moment you change it." aside={<AutosaveNote state={alerts.state} onRetry={alerts.retry} />}>
        <ToggleRow id="a-device" title="Email me when a new device signs in" checked={newDevice} onChange={(next) => { setNewDevice(next); void alerts.run(() => pause(600)); }} />
        <ToggleRow id="a-weekly" title="Weekly summary of sign-ins" help="Sent Monday morning." checked={weekly} onChange={(next) => { setWeekly(next); void alerts.run(() => pause(600)); }} />
      </FormSection>

      <FormSection title="Stay signed in" help="On a computer you don't use for anything else." aside={<AutosaveNote state={timeout.state} onRetry={timeout.retry} />}>
        <Segmented label="Sign me out after" value={after} onChange={(next) => { setAfter(next); void timeout.run(() => pause(600)); }} options={[{ key: "8h", label: "8 hours" }, { key: "24h", label: "1 day" }, { key: "7d", label: "7 days" }]} />
      </FormSection>

      <DangerZone>
        <DangerAction
          title="Sign out every other session"
          consequence="Your phone and any other computer are signed out now. This one stays signed in."
          label="Sign out others"
          confirm={{ title: "Sign out every other session?", description: "1 other session ends now (Safari on iPhone).", confirmLabel: "Sign out others", cancelLabel: "Keep them" }}
          onConfirm={() => pause(500)}
        />
        <DangerAction
          title="Turn off two-step verification"
          consequence="Signing in will only need your password. Your recovery codes stop working."
          label="Turn off"
          confirm={{ title: "Turn off two-step verification?", description: "Your account will be protected by your password alone.", confirmLabel: "Turn off", cancelLabel: "Keep it on" }}
          onConfirm={() => pause(500)}
        />
      </DangerZone>
    </FormSections>
  );
}

function SignInRow({ label, value, action }: { label: string; value: React.ReactNode; action: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="m-0 text-label text-[var(--body)]">{label}</p>
        <div className="mt-0.5 text-sm text-[var(--muted)]">{value}</div>
      </div>
      {/* Each opens its own short dialog in the real page; the sample only says so. */}
      <Button type="button" variant="secondary" size="sm" onClick={() => notify.done(`${action} opens its own dialog`)}>{action}</Button>
    </div>
  );
}

/* ── the rules ─────────────────────────────────────────────────────────────────────────────── */

const RULES: { part: string; when: string; never: string }[] = [
  { part: "Form section", when: "Every group of settings. Title and help left, fields right on wide screens; stacked on a phone. Short fields share a row.", never: "A card with its own title over a single-column form as wide as the screen." },
  { part: "Help text", when: "Why a section exists goes behind the (i) beside its title, in one or two plain sentences. Opens on hover and on click.", never: "A paragraph beside or under the title. Hidden format rules, warnings or legal wording: those stay on screen." },
  { part: "Save bar", when: "A section where you edit several fields and keep them together. Appears at the bottom when something changed, says how many, and stays in view while you scroll. A leave warning catches the rest.", never: "Save in the page header, in a toolbar, floating in a corner, or one Save per card." },
  { part: "Saves at once", when: "Switches and single choices that stand alone. A quiet \"Saving… / Saved\" beside them; an error stays with Retry.", never: "Mixing the two in one section. A section either saves together or saves at once." },
  { part: "Choices", when: "On/off: a switch. Two to five options: a segmented control. More than five: a dropdown.", never: "A dropdown for Warn/Block, or seven buttons for a time zone." },
  { part: "Advanced", when: "Settings most agencies never change. One closed line at the end of its form section; opens by itself when a link points inside.", never: "Rare options listed beside everyday ones." },
  { part: "Danger zone", when: "Anything that can't be undone or cuts someone off: cancel, turn off, revoke, sign out others. Last on the page, red outline, a question first.", never: "A red action in a toolbar next to Refresh, or without a confirmation." },
  { part: "Tabs", when: "A section longer than about a screen and a half, or with separate jobs. At most five, each named for the job. A number only when something needs attention.", never: "Nine tabs that run off the edge, or counts nobody can explain." },
  { part: "History", when: "The page header's \"Last changed · History\" line. Nothing else.", never: "A \"Recent changes\" card or a change-log tab inside a section." },
];

/* ── example 3: help behind the (i), in the two layouts (owner, 2026-10-29) ─────────────────── */

function HelpExample() {
  const fields = (
    <FieldRow>
      <Field label="Trading name" htmlFor="h-trading"><input id="h-trading" className={control} defaultValue="Power Policies" /></Field>
      <Field label="Legal name" htmlFor="h-legal" required><input id="h-legal" className={control} defaultValue="Masood Insurance Services LLC" /></Field>
    </FieldRow>
  );
  const info = "Clients see the trading name on the welcome pack, statements and letters. Tax forms and regulators use the legal name.";
  return (
    <FormSections>
      <p className="m-0 text-sm text-[var(--muted)]">Rest the mouse on the (i), or click it. The same section in each layout:</p>
      <FormSection layout="stacked" title="Names (stacked)" infoLabel="About names" info={info} aside={<StatusChip tone="good">Complete</StatusChip>}>{fields}</FormSection>
      <FormSection title="Names (split)" infoLabel="About names" info={info} aside={<StatusChip tone="good">Complete</StatusChip>}>{fields}</FormSection>
    </FormSections>
  );
}

function Rules() {
  return (
    <TableCard>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Part</TableHead>
            <TableHead>Use it for</TableHead>
            <TableHead>Never</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {RULES.map((rule) => (
            <TableRow key={rule.part} className="align-top">
              <TableCell className="w-40 py-3 align-top font-semibold whitespace-normal text-[var(--ink)]">{rule.part}</TableCell>
              <TableCell className="py-3 align-top leading-[1.5] whitespace-normal">{rule.when}</TableCell>
              <TableCell className="w-72 py-3 align-top leading-[1.5] whitespace-normal text-[var(--muted)]">{rule.never}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  );
}
