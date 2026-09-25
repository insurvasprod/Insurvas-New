# Publisher forms and market-access design QA

## Source visual truth

- Selected Product Design Option 1: `C:/Users/Victus/.codex/generated_images/01a0a5c3-f3df-7743-8adf-970864556ca2/exec-315c9896-4833-41f7-a788-d2a948f5396c.png`
- The source is a 1487 x 1058 desktop concept showing the publisher-admin form workspace, edit-field modal, partner preview, carrier/state matrix, and inherited-user banner.

## Implementation evidence

- Forms state: `design-qa-forms.png` (1265 x 712 browser screenshot; CSS viewport captured from the signed-in local app).
- Edit-field state: `design-qa-modal.png` (1265 x 712 browser screenshot).
- Carrier/state state: `design-qa-implementation.png` (1265 x 712 browser screenshot).
- Combined comparison input: `design-qa-comparison.png`, with the source on the left and the loaded Forms implementation on the right. The source and implementation were reviewed at normalized 768px height; the browser viewport is narrower than the 1440px design target, so the app's responsive crop is expected.

## State and interactions tested

- `/app/publishers` loaded the authenticated publisher directory and opened Apex Demo Publisher.
- Publisher detail tabs exposed `Overview`, `Team`, `Products`, `Forms`, `Carrier & States`, `Terms`, and `Activity`.
- `Forms` loaded the product form workspace and showed presets, `Contact only`, `Add field`, `Save as template`, field selection, required toggles, edit controls, move controls, delete controls, verification checklist, publish, and partner preview.
- `Edit SSN` opened the modal with stable field-key protection, neutral delete action, cancel, and save controls.
- `Add field` opened the shared-field modal. Selecting `Document number` exposed digit length, format mask, live preview, placeholder, help text, and required-by-default controls.
- `Carrier & States` loaded the appointment-intersection matrix. Ineligible carrier/state pairs rendered as unavailable and eligible pairs rendered as selectable cells.
- The global Agent workspace navigation and alerts/theme/sign-out controls remained present without duplicate navigation chrome.

## Required fidelity surfaces

- Typography: readable system UI hierarchy is retained; labels and supporting copy use the existing product tokens.
- Spacing and layout: the forms workspace uses a compact master/preview split, grouped sections, dividers, and responsive overflow for the wide market matrix.
- Colors and tokens: existing INSURVAS orange, muted surfaces, semantic active badges, and neutral destructive hover treatment are used.
- Image quality and assets: this screen is UI-only; no source illustrations or product imagery were replaced with placeholders.
- Copy/content: partner-facing requirements explicitly call out Product, Carrier, and State; the configuration copy explains catalog-only fields and inherited access.

## Findings

- No actionable P0/P1/P2 issues remain in the tested Forms, edit-field, or market-access states.
- The generated concept uses a dedicated admin navigation shell while the implementation intentionally preserves the application's existing Agent workspace shell and route hierarchy. This is an intentional product-shell constraint, not a functional or responsive defect.
- The selected concept shows the edit modal open and a denser full-page layout. The implementation supports the same interaction state and keeps the longer form and matrix inside bounded scrolling regions at the current browser width.

## Comparison history

1. Initial implementation review identified that custom document-number digit lengths were accepted by the editor but still used the legacy fixed nine-digit server pattern.
2. The validation generator was updated to derive the server regex and maximum formatted length from the configured format mask and digit length.
3. Typecheck, lint, production build, and browser smoke verification passed after the fix.

## Implementation checklist

- [x] Add shared catalog field modal.
- [x] Add document-number length, format-mask, placeholder, and live preview controls.
- [x] Add edit modal with stable key protection.
- [x] Add neutral delete action and preserve the mandatory phone field.
- [x] Add small up/down arrow controls and action divider.
- [x] Require Product, Carrier, and State in the partner preview and preserve server-side market enforcement.
- [x] Show carrier/state access as multiple selectable eligible appointment pairs.
- [x] Keep Partner Users read-only and communicate inherited admin configuration.
- [x] Run browser smoke verification, typecheck, lint, and production build.

## Follow-up polish

- At wider desktop widths, the app can move the inherited-user summary into the publisher header to more closely match the generated concept.
- Existing catalog fields created before the document-number editor may still have their original type metadata; editing the field to `Document number` enables the new mask controls without changing the stable field key.

final result: passed
