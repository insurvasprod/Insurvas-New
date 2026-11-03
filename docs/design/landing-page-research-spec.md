# Spec: Insurvas landing-page research and concept mockups

## Objective

Research a new visual direction for the Insurvas marketing homepage and prepare reviewable static mockups grounded in the actual insurance workflow. Preserve the current landing-page wording as a separate, verbatim copy baseline. The manager’s recording is intended to inform the concepts; spoken ideas must be transcribed before they are attributed to the manager.

The page is for life and health insurance agencies and call centers that buy leads. Explain the product through a simple, concrete story that a 12-year-old can follow, while retaining the existing copy unchanged in the concepts unless the user later approves copy changes.

This phase began as research and static concept work. The user has since requested implementation of specific landing-page visual refinements; the approved implementation scope is recorded below. It does not change application routes or product behavior.

## Assumptions

1. The audience remains the one named in the current hero: life and health agencies and call centers that buy leads.
2. The current landing-page copy is protected. A verbatim baseline is to be saved before concepts are presented; concepts may change layout, imagery, hierarchy, and motion only.
3. Research may use the supplied references and the Insurvas CRM source. Reference sites are inspiration, not templates to copy.
4. The simple story explains how a lead moves through an insurance sale and what Insurvas keeps connected along the way.
5. Mockups are review artifacts, not production-ready pages. No production implementation begins without separate approval after concept review.
6. Video frames can be reviewed locally. A transcript is still needed to reliably capture the manager’s spoken direction.

## Research snapshot

### Insurvas copy and brand source of truth

The current homepage is composed in `app/page.tsx` from the marketing components. Keep their wording unchanged while exploring visual structure:

- `components/marketing/landing-hero.tsx`
- `components/marketing/landing-sections.tsx`
- `components/marketing/landing-bento.tsx`
- `components/marketing/landing-exploded.tsx`
- `components/public/site-header.tsx` and `components/public/site-footer.tsx`

The hero currently says “Know what every lead really cost you.” and describes live transfers, dialing, applications, commissions, and tracing an issued policy to the campaign that paid for it. Its buttons are “Start your free trial” and “See the product.” The existing copy source remains untouched in this phase; a separate verbatim text snapshot is a required deliverable before mockups are reviewed.

Brand and marketing rules: `docs/design/BRAND.md`, `docs/design/UI-CONSISTENCY.md`, and `components/marketing/README.md`. The marketing site uses Montserrat and the Insurvas olive/green identity. Marketing claim wording must remain accurate to the CRM; sample figures must be labeled as sample data. Do not introduce unsupported results, testimonials, customer logos, security certifications, or guarantees.

### Product story from CRM source

The strongest specific story available in the repository is the relationship between lead source and acquisition cost, a live transfer, dialing and its compliance checks, an application, an issued policy, and a carrier commission line. This is a candidate narrative, not a claim that every workflow is always automated or that every record is complete. Explain True CPA only as the CRM computes it from linked data; do not equate it with profit.

### Supplied references

- [Saaspo](https://saaspo.com/): a broad gallery of SaaS landing pages and style filters. Use it to find individual visual patterns; it did not load directly in the research browser, so findings are limited to indexed pages.
- [SaaSUI](https://www.saasui.design/): a library organized around real product and interface patterns. Useful for studying concrete interaction and product-screen treatments, rather than borrowing its library-page layout.
- [Mintlify on Lapa Ninja](https://www.lapa.ninja/post/mintlify-2/): a recorded full-page example. Its page is described as self-updating documentation; borrow only any useful pacing or evidence presentation after visual review.
- [Insurvas Behance moodboard](https://www.behance.net/moodboard/227268593/Insurvas-Landing-Page): direct access was unavailable to the research browser. Review it in a normal browser before selecting anything from it.
- [PowerHours](http://powerhours.agency/): direct access was unavailable to the research browser. Treat the user’s link as a pending reference to inspect, not as reviewed evidence.
- [AgentCompass how-it-works](https://agentcompass.agency/how-it-works): direct access to this URL was unavailable. Search results exposed the related AgentCompass marketing page, which explains agency visibility through a three-step sequence and product-specific modules. Confirm the exact supplied page before drawing conclusions.

### Manager video

The supplied MP4 is 11m 28s. Frames were extracted locally at roughly 17-second intervals and reviewed. Audio was transcribed locally with ffmpeg's whisper.cpp filter and the `base.en-q5_1` model; the video audio was not sent to a transcription service. The transcript is [manager-video-transcript.srt](landing-page-research/manager-video-transcript.srt), with interpretation and uncertainty notes in [manager-video-notes.md](landing-page-research/manager-video-notes.md). The bundled watch frame pass could not run because installed ffmpeg 9 no longer accepts its `-vsync` option; direct ffmpeg extraction worked. The automatic transcript has uncertain proper names and several phrases; it is not a verified verbatim record.

## Tech Stack

- Existing product: Next.js, React, TypeScript, and CSS modules/Tailwind as used by the current marketing components.
- Research mockups: standalone static HTML and CSS under `docs/design/landing-page-research/`, outside the production route tree.
- No new runtime dependency is needed for the research artifacts.

## Commands

- Repository root: `C:\Users\Admin\Desktop\Repository\Insurvas-New`
- Current production page source: `app/page.tsx` and the marketing components listed above.
- Static mockup preview: open the selected `.html` file directly in a browser; if local asset loading requires a server, use the repo’s existing dev command only after checking which checkout and port it serves.
- Static concept artifacts need no automated test command. For the explicitly approved section refinements, use typecheck and verify the changed interaction in a browser; do not claim a viewport was reviewed unless it was.

## Project Structure

```text
docs/design/landing-page-research-spec.md      → this approved scope and acceptance contract
docs/design/landing-page-research/              → copy baseline, source notes, and static concepts
app/page.tsx                                    → homepage composition; unchanged by the landing refinements
components/marketing/                            → only the explicitly approved hero record and scroll story are in implementation scope
```

## User-approved hero record refinement (2026-11-03)

The user has now asked to refine the current landing hero record panel. Keep the logo, navigation,
headline, explanatory copy, buttons, and proof points as they are. The requested change is limited
to the right-side sample record: make it feel like a credible, modern CRM case file that shows the
lead source and a readable event history, using the Insurvas olive/green system and real interface
patterns from the CRM.

- Visual target: [`landing-page-research/hero-record-refinement-target.png`](landing-page-research/hero-record-refinement-target.png), 1587 × 991 px.
- Existing rendered baseline: user screenshot `codex-clipboard-28e846ba-7406-45e8-8780-529011561501.png`, 1536 × 912 px including browser chrome.
- The generated target is a layout reference only. Its dates and event descriptions were invented by image generation and must not be reused as facts. Preserve only source-backed sample details already present in the marketing artifacts, label them as sample, and keep “Needs review” distinct from an issued policy.
- Interaction: preserve the four keyboard-operable selectable moments and their existing explanations; add clear record context and restrained selection feedback without changing the left-side copy or product claims.

## User-approved scroll story refinement (2026-11-03)

The user explicitly requested that the five-moment story's scroll interaction be redesigned and improved. This approves implementation in `components/marketing/landing-evidence-story.tsx` and its existing CSS module only. The current copy, logo, navigation, hero and unrelated landing sections stay outside this refinement.

- Visual target: [`landing-page-research/scroll-story-refinement-target.png`](landing-page-research/scroll-story-refinement-target.png), 1587 × 991 px. It is an art-direction reference, not the exact type or layout to copy.
- Interaction: five readable chapter controls select the active moment. Scrolling through a chapter selects it automatically. A persistent, one-record evidence panel updates its event, fields, status and segmented five-moment trail with restrained transition motion; it must not invent dates, names, or dollar figures.
- Layout: use the existing Montserrat/Insurvas tokens and meaningful semantic status colors. The record remains legible while chapters scroll on desktop and narrow screens. Respect reduced-motion preferences without disabling scroll-based selection.
- Accessibility: keyboard-operable chapter buttons expose their selected state and control the evidence panel; active content remains understandable without motion.

## Subsequent motion redirection (2026-11-03)

The user rejected the paper-and-disc visual and the closing animation and requested further research and a different, more interactive direction. The newer work supersedes the visual targets above. See [motion redirection](landing-page-research/motion-redirection-2026-11-03.md) for sources, generated references, the new direction and verification limits. The user also explicitly requested better button labels. Sample representations remain illustrative, and pricing continues to come from the plan catalog.

## Concept Style

Use real workflow records and details from Insurvas as the visual material. Each mockup should show one clear story, with plain language and real product evidence. Keep copy verbatim, respect brand documentation, and label synthetic examples “Sample data.” Avoid a generic dashboard beside a headline, a generic feature-card grid, invented performance numbers, and abstract AI motifs.

Example of the desired story structure (illustrative labels only; not approved replacement copy):

```text
Lead source → call and application → policy issued → carrier commission matched
```

## Testing Strategy

- Verify copy preservation by comparing the saved baseline to the current homepage wording.
- Verify each product detail and claim against its CRM source before it appears in a mockup.
- Review each static concept in a browser at desktop and phone widths; inspect text legibility, responsive flow, and whether the story is understandable without product knowledge.
- Do not run automated tests for static research artifacts unless requested. Do not treat source review or a contact sheet as browser verification.

## Boundaries

- Always: keep this phase in research/mockup scope; preserve the current copy verbatim; mark sample values; distinguish inspected evidence from assumptions; cite the references used in the research notes.
- Ask first: change any landing-page wording beyond the explicitly approved current refinement; edit production routes or unrelated marketing components; add dependencies; publish or deploy a concept; use unverified customer/results/security claims.
- Never: present mockups as production-ready; attribute untranscribed speech to the manager; imply sample CPA is profit; copy a reference site wholesale; replace the user’s preferred copy without approval.

## Success Criteria

1. A verbatim copy baseline covering all visible homepage sections, navigation, and footer exists separately from the production components.
2. The research notes compare the accessible references and record access limits for inaccessible links.
3. Product details and claims in each concept map to current CRM evidence; unverified claims are excluded or marked as unresolved.
4. At least two static concept directions are available for review, each telling the product story in language a 12-year-old can understand while preserving the original copy.
5. The manager’s spoken input is summarized with timestamps and uncertainty labels; no unclear phrase is treated as a firm requirement.
6. Each concept has been checked in a browser at desktop and phone widths before it is presented as visually reviewed.
7. No production page or product code changes occur in this phase.

## Open Questions

1. Should the copy baseline include every visible label in navigation/footer and pricing, or only the main body copy? This spec assumes all visible homepage wording.
2. The transcript is available, but automatic recognition is uncertain around some proper names and a few phrases. Confirm any quoted wording that matters to the final concept.
3. PowerHours and the supplied AgentCompass how-it-works page were inaccessible to the browser research tool. Can the user’s browser reach them, or should the concept research proceed with the accessible references and CRM evidence?
4. Who is the primary conversion target for the concept review: individual agents, agency owners, or call-center operators? The current audience copy addresses several groups.

## Approval Gate

The current copy-baseline and static-concept work remains subject to the research approval gate. The user has separately and explicitly approved implementation of the hero record and five-moment scroll story refinements above; that authorization does not extend to unrelated homepage sections, routes, or copy changes.
