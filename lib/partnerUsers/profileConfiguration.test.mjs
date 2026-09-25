import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("partner profiles are immutable, tenant-scoped revisions with draft snapshots", async () => {
  const migration = await source(
    "supabase/migrations/20260916100000_partner_form_draft_profile_snapshots.sql",
  );
  assert.match(
    migration,
    /partner_submission_profile_id uuid references public\.partner_submission_profiles/,
  );
  assert.match(migration, /partner_submission_profile_revision integer/);
  assert.match(migration, /save_partner_submission_profile_revision/);
  assert.match(
    migration,
    /revoke all on function public\.save_partner_submission_profile_revision/,
  );
});

test("partner portal resolves saved profile revisions and verification uses them", async () => {
  const templates = await source("lib/agentTemplates/service.ts");
  const verification = await source("lib/verification/service.ts");
  const portal = await source("app/api/partner/forms/[productCode]/route.ts");
  const draft = await source(
    "app/api/partner/forms/[productCode]/draft/route.ts",
  );
  const leads = await source("app/api/partner/leads/route.ts");
  assert.match(templates, /getPartnerTemplateForProductProfileRevision/);
  assert.match(templates, /verification_fields/);
  assert.match(verification, /partner_submission_profile_id/);
  // Partner configuration may narrow intake, but the agent verification panel must resolve the
  // complete tenant/product snapshot so fields hidden from the partner are still confirmable.
  assert.match(verification, /verificationTemplate/);
  assert.match(verification, /getTenantTemplateForProductVersion/);
  assert.match(verification, /Agent verification is broader/);
  assert.match(verification, /configuration: context\.profile/);
  assert.match(portal, /getPartnerTemplateForProduct/);
  assert.match(
    draft,
    /partner_submission_profile_id:\s*profileTemplate\.partner_submission_profile_id/,
  );
  assert.match(leads, /loadFormDraft/);
  assert.match(leads, /getTenantTemplateForProductVersion/);
});

test("publishers UI exposes the hierarchy and inherited configuration workflow", async () => {
  const publishers = await source("components/app/partners-workspace.tsx");
  const team = await source("components/app/partner-users-panel.tsx");
  const formStudio = await source("components/app/partner-form-studio.tsx");
  assert.match(publishers, /detailTab === "team"/);
  // A partner opens on its own page (/app/publishers/[id]); the way out is the "Back to partners" link
  // above its title, and the directory keeps a close control for a selection on small screens.
  assert.match(publishers, /Back to partners/);
  assert.match(publishers, /aria-label="Close details"|Close details/);
  assert.match(team, /View users/);
  assert.match(team, /Hide users/);
  assert.match(team, /Unassigned users/);
  assert.match(team, /<PartnerFormStudio/);
  assert.match(formStudio, /Restore inherited/);
  assert.match(formStudio, /verification_fields/);
  const configPanelIndex = team.indexOf("<PartnerUserWorkspace");
  const teamListIndex = team.indexOf('<CardContent className="p-0">');
  assert.ok(
    configPanelIndex >= 0 &&
      teamListIndex >= 0 &&
      configPanelIndex > teamListIndex,
    "configuration renders inside the Team workspace beside the hierarchy",
  );
  assert.doesNotMatch(
    await source(
      "app/api/app/partners/[id]/users/[userId]/form-profile/route.ts",
    ),
    /Assign this partner user to a partner admin before configuring an override/,
  );
});
