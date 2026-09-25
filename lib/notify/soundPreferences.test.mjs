// Run with: npm test
//
// Step 3 made the per-treatment choices reachable and per-user. These assertions guard the parts of
// that which are easy to get wrong quietly: the difference between "no opinion" and "off", the two
// treatments that must never acquire a switch, and the duplicate control this replaced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

import { AUDIBLE, AUDIBLE_BY_DEFAULT, TREATMENTS, TREATMENT_LABELS } from "./treatments.ts";

const root = process.cwd();
const read = (...p) => readFileSync(join(root, ...p), "utf8");

test("the vocabulary is importable without dragging in a browser or a server", () => {
  // The whole reason this module exists. `sound.ts` is "use client" and the settings service is
  // `server-only`; both now need the treatment list. Importing across that line compiles cleanly
  // under tsc and fails only at `next build` — a trap this codebase has already fallen into once.
  const source = read("lib", "notify", "treatments.ts");
  // The directive, not a mention of it: this file's own comment explains the trap it avoids.
  const firstStatement = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").trim().split(/\r?\n/)[0];
  assert.doesNotMatch(firstStatement, /use client/, "the shared vocabulary became client-only");
  assert.doesNotMatch(firstStatement, /server-only/, "the shared vocabulary became server-only");
  assert.doesNotMatch(source, /^import /m, "the shared vocabulary grew an import, which is how it acquires a side of the boundary");
});

test("only the audible four can ever be given a switch", () => {
  // `done` and `fail` are silent by design. A control for them would be a lie, and the first person
  // to write the obvious loop over the settings object would quietly make them audible.
  assert.deepEqual([...AUDIBLE].sort(), ["arrive", "block", "warn", "win"]);
  assert.equal(AUDIBLE.includes("done"), false);
  assert.equal(AUDIBLE.includes("fail"), false);

  const ui = read("components", "app", "notification-sound-settings.tsx");
  assert.match(ui, /AUDIBLE\.map/, "the settings panel no longer derives its rows from the audible set");
  assert.doesNotMatch(ui, /TREATMENTS\.map/, "the settings panel offers a switch for every treatment, including the silent ones");

  const route = read("app", "api", "app", "notifications", "route.ts");
  assert.match(route, /AUDIBLE\.map/, "the endpoint no longer derives its accepted keys from the audible set");
  assert.match(route, /\.strict\(\)/, "the endpoint accepts unknown sound keys");
});

test("the database refuses a switch for a silent treatment", () => {
  const migration = read("supabase", "migrations", "20260923180000_notify_sound_treatments_are_a_user_setting.sql");
  assert.match(migration, /'win', 'arrive', 'warn', 'block'/, "the column no longer constrains which treatments may appear");
  assert.match(migration, /jsonb_typeof\(entry\.value\) <> 'boolean'/, "a non-boolean can be stored, which reads as neither on nor off");
  assert.match(migration, /add column if not exists/, "the migration stopped being re-runnable");
  assert.doesNotMatch(migration, /drop\s+(table|column)/i, "the migration became destructive");
});

test("a missing key means the default, not off", () => {
  // The distinction the whole storage shape turns on. If an unset treatment stored `false`, then
  // changing a default later would reach nobody who had ever opened the panel — and opening a
  // panel is not consent to freeze every default in it.
  const ui = read("components", "app", "notification-sound-settings.tsx");
  assert.match(
    ui,
    /chosen\[treatment as AudibleTreatment\] \?\? AUDIBLE_BY_DEFAULT\.includes\(treatment\)/,
    "an unset treatment no longer falls back to the default",
  );

  const presentation = read("lib", "agentAlerts", "presentation.ts");
  assert.match(presentation, /sound_treatments: \{\}/, "the default settings pre-fill the treatment choices, erasing 'no opinion'");
  for (const treatment of AUDIBLE_BY_DEFAULT) assert.ok(AUDIBLE.includes(treatment));
});

test("every treatment a person can be shown has words for what it means", () => {
  for (const treatment of TREATMENTS) {
    assert.ok(TREATMENT_LABELS[treatment]?.label, `${treatment} has no label`);
    assert.ok(TREATMENT_LABELS[treatment]?.hint, `${treatment} has no explanation`);
  }
});

test("each sound can be auditioned before it is chosen", () => {
  // Nobody can pick between four sounds they have never heard from a list of adjectives, and a
  // sound you cannot audition is one you switch off.
  const ui = read("components", "app", "notification-sound-settings.tsx");
  assert.match(ui, /previewTreatment\(treatment\)/, "the preview buttons stopped playing anything");
  assert.match(ui, /aria-label=\{`Play the/, "the preview buttons are unlabelled for a screen reader");
});

test("the agent plane has one set of sound controls, not two", () => {
  // PortalSoundControls carried its own mute, do-not-disturb and volume in localStorage, directly
  // beneath the server-stored mute, do-not-disturb and volume. Two sets of switches with the same
  // names governing different things is worse than either on its own.
  // The agent bar's preferences moved into their own component when the bar became shared by all
  // three shells; the bar mounts it as the agent feed's `preferences`. So: the bar reaches the
  // panel, the panel holds the sound settings, and neither carries the duplicate — one set, once.
  const bar = read("components", "app", "app-top-bar.tsx");
  const panel = read("components", "app", "agent-alert-preferences.tsx");
  assert.match(bar, /preferences: <AgentAlertPreferences /, "the agent bar no longer reaches its preferences panel");
  assert.match(panel, /<NotificationSoundSettings /, "components/app/agent-alert-preferences.tsx lost the sound settings entirely");
  assert.equal((panel.match(/<NotificationSoundSettings /g) ?? []).length, 1, "the agent preferences render the sound settings more than once");
  assert.doesNotMatch(bar, /NotificationSoundSettings/, "the agent bar renders sound settings of its own beside the preferences panel's");
  for (const source of [bar, panel]) {
    assert.doesNotMatch(source, /PortalSoundControls/, "the agent plane still renders the duplicate localStorage sound controls");
  }
  // The partner plane had the legacy control until step 4 migrated its last call site, at which
  // point the bridge could no longer hear anything and that control governed nothing at all. It
  // now has the same panel, local-only, because it still decides what those people hear.
  const partner = read("components", "partner", "partner-settings-workspace.tsx");
  assert.match(partner, /NotificationSoundSettings/, "the partner plane lost its only sound control");
  assert.doesNotMatch(partner, /PortalSoundControls/, "the partner plane kept a control that governs nothing");
});

test("the server is the writer and localStorage only mirrors it", () => {
  // Two stores that can disagree about whether a sound is on is how a muted agent hears a chime.
  const sound = read("lib", "notify", "sound.ts");
  assert.match(sound, /saveSoundPreferences\(\{ \.\.\.current, enabled: settings\.sound_treatments \}\)/, "the mirror no longer tracks the server");
  // And it must NOT track it while the storage column is pending: the server answers `{}` then,
  // meaning "nowhere to put it", not "nobody chose anything". Mirroring that wipes the local
  // choice on every poll — silently, every 2.5 seconds.
  assert.match(sound, /treatmentsAreAuthoritative && settings\.sound_treatments/, "an unstorable empty answer can now overwrite the local choice");
});

test("a pending migration cannot take the alert centre down with it", () => {
  // The column is additive and not yet applied. Without the downgrade, every read of this table
  // 42703s — which breaks everyone's alerts, not just the new setting.
  const service = read("lib", "agentAlerts", "service.ts");
  assert.match(service, /isMissingColumn/, "the missing-column downgrade is gone");
  assert.match(service, /42703/, "the downgrade no longer recognises a missing column");
  assert.match(service, /result = await read\(BASE_COLUMNS\)/, "a missing column no longer falls back to the columns that do exist");
  assert.match(service, /result = await write\(false\)/, "a missing column stops the rest of the settings saving at all");
});

test("step 4: sonner is reached through the vocabulary and nowhere else", () => {
  // The end state the migration exists to produce. A raw `toast.error` is not wrong so much as
  // meaningless — it is the green-box/red-box world this work replaced, and one reintroduced by
  // hand would spread, because the next person copies the line above them.
  const importers = execSync(
    'grep -rl \'from "sonner"\' --include=*.tsx --include=*.ts components app lib',
    { encoding: "utf8" },
  )
    .split("\n")
    // grep on Windows reports backslash separators; normalise without writing a backslash literal,
    // which this repo's shell heredocs mangle.
    .map((f) => f.trim().split(String.fromCharCode(92)).join("/"))
    .filter(Boolean)
    .filter((f) => !f.includes("components/ui/sonner"));

  assert.deepEqual(
    importers,
    ["lib/notify/index.ts"],
    `sonner is imported outside the notification vocabulary: ${importers.join(", ")}`,
  );
});

test("step 4: the DOM-observing sound bridge is retired, not merely bypassed", () => {
  // Once every toast is notify-owned the bridge can never match anything, so what is left is a
  // MutationObserver on document.body with subtree:true, paying for every DOM change in the app to
  // reach a `continue`. And PortalSoundControls, which gated it, became a switch wired to nothing —
  // the same lying control this work removed from the agent plane in step 3.
  for (const layout of [["app", "app", "(shell)", "layout.tsx"], ["app", "partner", "(portal)", "layout.tsx"]]) {
    const source = read(...layout);
    assert.doesNotMatch(source, /PortalFeedbackBridge/, `${layout.join("/")} still mounts the inert sound bridge`);
  }
});
