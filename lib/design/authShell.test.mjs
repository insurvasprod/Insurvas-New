// Run with: npm test
//
// One auth layout (docs/design/foundation-v3/SPEC-auth-shell.md, UI-CONSISTENCY.md §13): every
// sign-in and sign-up screen renders through AuthLayout, and none draws its own shell, heading,
// stepper or alert box. Before this, they shared a split shell but built everything else their own
// way — five heading styles, four panels, three input heights, four alert boxes.
//
// DB-free and network-free: reads source text only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Each auth route, and the file that draws its screen (where the page delegates to a component). */
const SCREENS = {
  "app/app/login/page.tsx": "components/app/tenant-auth-workspace.tsx",
  "app/signup/page.tsx": "components/public/signup-form.tsx",
  "app/app/verify-email/page.tsx": "components/app/verify-email-panel.tsx",
  "app/app/onboarding/business-profile/page.tsx": "components/app/business-profile-form.tsx",
  "app/app/onboarding/plan/page.tsx": "components/app/plan-choice.tsx",
  "app/app/checkout/page.tsx": "components/public/checkout-view.tsx",
  "app/app/checkout/return/page.tsx": null,
  "app/app/welcome/page.tsx": null,
  "app/app/set-password/page.tsx": "components/app/set-password-form.tsx",
  "app/app/confirm-email/page.tsx": "components/app/confirm-email-panel.tsx",
  "app/app/suspended/page.tsx": null,
  "app/verification-failed/page.tsx": null,
  "app/app/accept-terms/page.tsx": "components/app/accept-terms-panel.tsx",
  "app/partner/login/page.tsx": "components/partner/partner-login-form.tsx",
  "app/partner/accept-invite/page.tsx": "components/partner/accept-partner-invite-form.tsx",
  "app/partner/set-password/page.tsx": "components/partner/partner-set-password-form.tsx",
  "app/admin/login/page.tsx": null,
};

/** The wrappers that are AuthLayout with a plane and a story already chosen. */
const LAYOUT = /<(?:AuthLayout|FunnelFrame|AppAuthFrame|PartnerAuthFrame)\b/;

test("AuthLayout is the only component that renders the split shell", () => {
  const walk = (dir, out = []) => {
    for (const entry of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${entry}`;
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
      else if (rel.endsWith(".tsx")) out.push(rel);
    }
    return out;
  };
  const users = [...walk("app"), ...walk("components")].filter((file) => /<PortalAuthSplitShell\b/.test(code(file)));
  assert.deepEqual(users, ["components/portal/auth-layout.tsx"]);
  for (const wrapper of ["components/app/funnel-frame.tsx", "components/app/app-auth-frame.tsx", "components/partner/partner-auth-frame.tsx"]) {
    assert.match(code(wrapper), /<AuthLayout\b/, `${wrapper} must be a wrapper over AuthLayout`);
  }
});

test("every auth route renders through the one layout", () => {
  const missing = [];
  for (const [page, screen] of Object.entries(SCREENS)) {
    const files = [page, screen].filter(Boolean).map(code).join("\n");
    if (!LAYOUT.test(files)) missing.push(page);
  }
  assert.deepEqual(missing, [], "these auth routes do not render through AuthLayout");
});

test("no auth screen draws its own heading, stepper or alert box", () => {
  const offenders = [];
  for (const file of [...new Set(Object.entries(SCREENS).flat().filter(Boolean))]) {
    const source = code(file);
    if (/<h1\b/.test(source)) offenders.push(`${file}: an <h1> (use AuthHeading)`);
    if (/aria-label="(?:Sign-up progress|Sign-in steps)"[^>]*>\s*$/m.test(source) || /<ol[^>]*grid-cols-[25]/.test(source)) offenders.push(`${file}: its own stepper (use AuthSteps)`);
    if (/portal-auth-alert|role="alert"[^>]*bg-\[var\(--error-surface\)\]|bg-\[var\(--error-surface\)\][^>]*role="alert"/.test(source)) offenders.push(`${file}: its own alert box (use AuthAlert)`);
  }
  assert.deepEqual(offenders, []);
});

test("auth fields and primary buttons are 44px", () => {
  const controls = code("components/portal/auth-controls.tsx");
  assert.match(controls, /export const authControl =\s*"[^"]*\bh-11\b/);
  assert.match(controls, /export function AuthSubmit[\s\S]*?"h-11 w-full"/);
  // No auth screen keeps the old 48px (h-12) or 40px (h-10) buttons.
  const tall = [];
  for (const file of [...new Set(Object.entries(SCREENS).flat().filter(Boolean))]) {
    if (/<Button\b[^>]*className="[^"]*\bh-1[02]\b/.test(code(file))) tall.push(file);
  }
  assert.deepEqual(tall, []);
});
