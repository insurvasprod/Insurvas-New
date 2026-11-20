// Bug walk 2026-11-20 · the producer record (manager dialog, onboarding, carriers) and the licence pointers in
// Settings › Team & Access and My profile.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  OWNER_CHOICE, licencePointer, managerChoices, managerSaveOutcome, onboardingTitle, readFresh, teamAccessMemberHref,
} from "../../components/app/agency/producer-record-core.ts";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const roster = [
  { id: "p1", displayName: "Demo Manager", email: "lead.one@example.test", status: "active", role: "manager" },
  { id: "p2", displayName: "Demo Manager", email: "lead.two@example.test", status: "active", role: "manager" },
  { id: "p3", displayName: "Ana Agent", email: null, status: "onboarding", role: "producer" },
  { id: "p4", displayName: "Gone Person", email: "gone@example.test", status: "offboarded", role: "producer" },
  { id: "p5", displayName: "Invited Person", email: "new@example.test", status: "invited", role: "manager" },
  { id: "me", displayName: "The Producer", email: "me@example.test", status: "active", role: "producer" },
];

test("bug 1 · two managers with one name are told apart by their email, managers listed first", () => {
  const choices = managerChoices(roster, "me");
  assert.deepEqual(choices.map((c) => c.value), [OWNER_CHOICE, "p1", "p2", "p3"]);
  assert.deepEqual(choices.filter((c) => c.label === "Demo Manager").map((c) => c.description), ["lead.one@example.test", "lead.two@example.test"]);
  assert.equal(choices[1].group, "Managers");
  assert.equal(choices[3].group, "Producers");
  assert.equal(choices[3].description, undefined, "no email, no empty second line");
  assert.ok(!choices.some((c) => c.value === "me"), "never himself");
});

test("bug 2 · a save is reported only when the record shows it", () => {
  const today = "2026-11-20";
  assert.deepEqual(managerSaveOutcome({ chosen: "p2", effectiveFrom: today, today, saved: { managerProducerId: "p2", managerName: "Demo Manager" } }), { ok: true, managerName: "Demo Manager" });
  const missed = managerSaveOutcome({ chosen: "p2", effectiveFrom: today, today, saved: { managerProducerId: null, managerName: "Owner" } });
  assert.equal(missed.ok, false);
  assert.match(missed.message, /did not save: they still report to the owner/);
  assert.equal(managerSaveOutcome({ chosen: "p2", effectiveFrom: today, today, saved: null }).ok, false, "unreadable record is not a success");
  assert.deepEqual(managerSaveOutcome({ chosen: null, effectiveFrom: today, today, saved: { managerProducerId: null, managerName: "Owner" } }), { ok: true, managerName: "the owner" });
  assert.deepEqual(managerSaveOutcome({ chosen: "p2", effectiveFrom: "2026-12-01", today, saved: null }), { ok: true, managerName: null }, "a dated-ahead move cannot show yet");
});

test("bug 2 · the dialog sends the pick from state, opens on the current manager and reads the record back", () => {
  const dialog = read("components/app/agency/producer-dialogs.tsx");
  assert.match(dialog, /useState<string>\(currentManagerId \?\? OWNER_CHOICE\)/);
  assert.match(dialog, /managerProducerId: chosen, effectiveFrom: from/);
  assert.match(dialog, /if \(message\) \{ setError\(message\); return; \}/);
  assert.match(dialog, /readFresh<[^>]+>\(`\/api\/app\/agency\/producers\/\$\{producerId\}`\)/);
  assert.match(dialog, /if \(!outcome\.ok\) \{ setError\(outcome\.message\)/);
  assert.match(dialog, /<SelectMenu label="Reports to"/);
});

test("bugs 6 and 7 · a refresh after a change never joins an older read", async () => {
  const calls = [];
  const fetcher = async (url, init) => { calls.push([url, init]); return { ok: true, status: 200, json: async () => ({ rows: [1] }) }; };
  assert.deepEqual(await readFresh("/api/x", fetcher), { rows: [1] });
  assert.deepEqual(calls, [["/api/x", { cache: "no-store" }]]);
  const failing = async () => ({ ok: false, status: 409, json: async () => ({ error: "Taken." }) });
  await assert.rejects(readFresh("/api/x", failing), (error) => error.message === "Taken." && error.status === 409);
  const hook = read("components/app/agency/use-agency-data.ts");
  assert.match(hook, /mode === "refresh" \? await readFresh<T>\(url\)/);
  assert.doesNotMatch(hook, /load as loadResource/);
  assert.match(read("components/app/agency/producer-carriers-tab.tsx"), /setState\(""\); setExpires\(""\);[\s\S]{0,200}await reload\(\);/);
});

test("bug 7 · the onboarding count is the rows' count, an approved (stamped) item included", () => {
  const items = [{ item: "licence", done: false }, { item: "contracting", done: false }, { item: "w9", done: false }, { item: "levels", done: true }];
  assert.equal(onboardingTitle({ items, canSubmit: false, isSelf: false }).title, "They can't submit yet · 3 items missing");
  assert.equal(onboardingTitle({ items, canSubmit: false, isSelf: false, stamped: (i) => i === "contracting" }).title, "They can't submit yet · 2 items missing");
  assert.equal(onboardingTitle({ items: [{ item: "w9", done: false }], canSubmit: false, isSelf: true }).title, "You can't submit yet · 1 item missing");
  assert.equal(onboardingTitle({ items: [], canSubmit: true, isSelf: false }).title, "They can submit applications");
  assert.match(read("components/app/agency/producer-onboarding-tab.tsx"), /onboardingTitle\(\{ items: data\.items/);
});

test("bug 3 · the licence pointer: a working link for the owner, who-sets-it for everyone else", () => {
  assert.equal(teamAccessMemberHref("u-1"), "/app/settings?member=u-1#team-access");
  assert.deepEqual(licencePointer({ viewerIsOwner: true, isSelf: false, userId: "u-1" }), { kind: "link", href: "/app/settings?member=u-1#team-access", label: "Set in Team & Access" });
  assert.deepEqual(licencePointer({ viewerIsOwner: false, isSelf: true, userId: "u-1" }), { kind: "text", text: "Your owner sets it in Settings › Team & Access" });
  assert.equal(licencePointer({ viewerIsOwner: false, isSelf: false, userId: "u-1" }).kind, "text");
  assert.doesNotMatch(read("components/app/agency/producer-onboarding-tab.tsx"), /Settings › Team › licensed states/);
  // Team & Access opens the member named in ?member= on mount.
  const team = read("components/app/team-settings.tsx");
  assert.match(team, /searchParams\.get\("member"\)/);
  assert.match(team, /setOpenId\(member\.id\)/);
  // My profile points to the owner, never to the producer record.
  const profile = read("components/app/own-profile-form.tsx");
  assert.doesNotMatch(profile, /Producer Record/);
  assert.match(profile, /your owner sets them, with each licence's end date, in Settings › Team & Access/);
});

test("bug 4 · a licence end date is never called optional", () => {
  const chips = read("components/app/settings/team/state-chips.tsx");
  assert.doesNotMatch(chips, /Optional\. After this date/);
  assert.match(chips, /Needed before an agency producer can submit applications\./);
});

test("bug 5 · Team & Access says Manager, as the rest of the app does", () => {
  for (const path of ["components/app/team-settings.tsx", "components/app/settings/team/person-sheet.tsx"]) {
    const source = read(path);
    assert.doesNotMatch(source, /Team lead/, path);
    assert.match(source, /MEMBER_ROLE_LABELS\.manager/, path);
  }
  assert.match(read("lib/tenantAuth/roles.ts"), /manager: "Manager"/);
});
