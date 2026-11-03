# Feature section direction update

Updated 3 November 2026 after review of the four feature tiles. This is a local landing-page prototype; it does not change the site logo, the existing headline, the four card titles, or their descriptions.

## Design target and guardrails

- Desktop composition target: generated UI reference at 1536 × 1024, saved at `C:\Users\Admin\.codex\generated_images\01a19e6c-5872-7762-98de-69f25ff0f16e\exec-88be921b-0147-4901-9c89-6df4cb915a0b.png`. It was inspected before implementation. Use its source-to-floor globe, quiet record panels, asymmetric card proportions, and clear state controls as composition cues only.
- The generated image also contained made-up lead counts, policy identities, acquisition totals, issued-policy totals, and reconciliation variances. None of those are used in the implementation.
- Available CRM evidence does not establish geographic coordinates for the three marketing sample vendors. The globe is therefore explicitly a sample transfer-network illustration, not a live location map. Selecting a vendor changes the highlighted route, source inspector, and CPA example together.
- Only the existing marketing sample CPA values ($227.44, $312, and $488) are shown, under a sample-data label. A missing policy link remains an em dash. The commission example uses the previously observed fictional $84 carrier payment, omits the test customer's identity and record id, and keeps expected commission unavailable when the rate is not configured.
- Motion is tied to user input: selecting a source moves the route once; “Replay” walks through the four checks; the statement control swaps between linked and review states. All remain usable without motion under `prefers-reduced-motion`.

## Research notes

- [WN Studio's Uni-World case](https://www.wnstudio.dk/case/uni-world) makes a globe useful because its vessels and routes are real operational data. The Insurvas lesson is to connect the map to a real decision and selected record; without verified vendor geography, do not imply mapped source locations.
- [BPM's interactive financial dashboard case](https://www.bpm.com/case-study/interactive-financial-dashboard/) keeps underlying statement details available while a viewer explores the summary. The Insurvas version pairs a selected source with its transfer outcome and CPA detail rather than making the visitor infer a chart.
- [Swath's case study](https://webraw.studio/work/swath/) uses one visual model across successive product explanations. Here, source → agent floor → claim is the single model carried through the globe, inspector, and linked CPA state.
- Internal workflow evidence: [CRM observations](crm-workflow-observations-production-2026-11-03.md) and [story evidence](workflow-story-evidence-2026-11-03.md). They show that a dash for CPA means no issued policy is linked, and that a carrier payment can be recorded even when the expected commission is unavailable. This is why the demo preserves both conditions instead of inventing a clean success arc.

## Changed components

- Replaced the decorative globe, shield, glossy fake policy, and oversized money chart with one source-to-floor visual, a replayable pre-dial gate, a statement-to-policy match, and a linked True CPA comparison.
- Kept the original copy and brand palette, added real keyboard and button controls, and reflowed the bento to one column before the workflow panels become cramped.
- Browser review is recorded in the handoff; no production deploy or Git delivery is part of this prototype pass.
