# Insurvas landing page: reference analysis

Research only, 2026-11-03. No mockup or production page changes are proposed as completed work here. The observations below distinguish live sites from design concepts. The browser was approximately 830 px wide; this was not a full desktop or mobile audit.

## What went wrong in the prior explorations

- They focused on arranging a product-looking object before deciding what the visitor should understand or feel. A large row, card, table, or photograph became the idea by itself.
- Several showed too many stages and tiny data points at once. A first-time visitor had to decode the illustration before understanding the product.
- Generated interface details invented product facts. One image put estimated premium and commission on waiting transfers; another presented the wrong pre-dial checks. Those are not reliable evidence of Insurvas behavior.
- Stock-style agents, fake logos, generic dashboard panels, ornamental documents, and decorative green paths produced a synthetic marketing feel. They did not give the site a recognizable, credible identity.
- The simple HTML prototype demonstrated steps but lacked the visual craft, authentic product material, and strong creative idea needed for the requested presentation. It was not visually verified in a browser.

## Reference audit

### Hourline: a distinct idea carried through the page

Source: [Behance project on the Insurvas moodboard](https://www.behance.net/gallery/257094333/Hourline-Resource-Planning-SaaS-Website), [live concept](https://overseen.agency/gallery/hourline/). **Concept project**, not evidence of a real commercial product.

The project's own description says it started with the agency's problem: finding out on Friday what it needed to know on Monday. Its dawn setting, a 06:00 forecast, product sample, and examples all reinforce that proposition. The live concept begins with a clock sequence, then opens on a headline, a forecast prompt, and a detailed demonstration. The presentation is more than a generic dashboard, but the screenshot still contains a recognizable product view.

**Take:** establish an Insurvas-specific point of view first, then carry it through copy hierarchy, scene, product details, and motion. Give each example a reason to exist.

**Do not copy:** the sunrise, forecast, exact composition, or mandatory introductory wait. Hourline's product is forecasting; Insurvas needs its own grounded idea.

### PowerHours: a specific job for a specific room

Source: [PowerHours](https://www.powerhours.agency/). Visually inspected the hero and read its feature sequence in the browser.

The hero names the activity — dials, contacts, and appointments on a wall — and the site explains joining, tracking, roster, and leaderboards with named product screenshots. Its strong display type and dark/yellow visual treatment suit its competitive, live-floor positioning.

**Take:** write and show a real job in the visitor's world. A concrete screenshot with one explanatory point can establish trust quickly.

**Do not copy:** its typography, yellow palette, leaderboard framing, or performance metrics. PowerHours is about team activity; Insurvas's scope and buyer question differ.

### AgentCompass: relationships, then optional detail

Source: [AgentCompass how it works](https://agentcompass.agency/how-it-works). Browser access succeeded in this research pass; the earlier text-only research tool could not fetch it. Inspected the introduction and detail panel; the full map was not exhaustively tested.

The page offers application lifecycle, onboarding, and carrier/snapshot views. The lifecycle explains where information comes from and where it goes, with an optional map, focused description, and short video.

**Take:** show a useful relationship and let interested visitors explore details. Establish the simple overview before revealing a complex map.

**Risk:** a full integrations map at the top of an Insurvas homepage could overwhelm a new visitor. The product explanation must work without opening a map or watching a video.

### Mintlify: hierarchy and a visible product

Source: [Mintlify](https://www.mintlify.com/), also referenced in the supplied [Lapa Ninja entry](https://www.lapa.ninja/post/mintlify-2/). Visually inspected the current homepage hero at the browser width above.

The page pairs a clear headline and two actions with a large documentation preview below. A restrained graphic connects the identity to the product presentation. Its customer stories later have named sources; they are Mintlify's evidence, not Insurvas proof.

**Take:** give the headline, action, and product their own visual space; show a believable product early. Do not import its ribbon graphic, customers, numbers, or claims.

### Attio: product context and progressive detail

Source: [Attio](https://attio.com/). Inspected the current hero and page content. Its current messaging is about agentic revenue, which is not an Insurvas positioning recommendation.

The hero is concise, with a product scene below it. The following sections group the product by jobs such as building pipeline and converting leads, rather than exposing the full interface at once.

**Take:** reveal the interface in pieces sized for the story; give a visitor an obvious next step. Keep product facts and sample records specific to insurance.

### The Behance board: two different kinds of inspiration

Source: [Insurvas Landing Page moodboard](https://www.behance.net/moodboard/227268593/Insurvas-Landing-Page). Browser access succeeded; nine items were visible. Examined Hourline and the [CRM SaaS landing page](https://www.behance.net/gallery/242463657/CRM-SaaS-Landing-Page) more closely.

The CRM concept uses a blue hero and a large dashboard with multiple feature sections. Hourline instead has a clear narrative and an atmosphere tied to the product's promise. Both provide examples of production values and hierarchy, but they are concepts; their sample testimonials, logos, figures, and product behavior are not Insurvas evidence.

**Take:** study precision, contrast, spacing, and section rhythm. Give Insurvas a more specific story than a generic CRM dashboard.

### Reference libraries

[SaaSUI](https://www.saasui.design/) is a browsable library of product interfaces, useful for studying how actual tables, forms, and navigation are presented. [Saaspo](https://saaspo.com/) surfaced indexed examples in web search and appeared in the manager's recording, but direct browser access was stopped by a security verification screen in this pass. Do not treat its individual designs as visually reviewed here. The manager's recording also shows the [Lapa motion gallery](https://www.lapa.ninja/motion/) and SaaSUI pattern categories.

## What Insurvas can use as real material

- `components/app/inbound/live-transfer-card.tsx` describes a waiting transfer with customer, product, partner, state, waiting time and screening. It describes claim-next behavior where the first claim wins and a lost race is communicated. This is source evidence, not a signed-in production verification.
- `app/app/(shell)/campaigns/page.tsx` describes vendors, batch costs and cost per usable lead, behind feature and role gates.
- `components/marketing/landing-hero.tsx`, `landing-exploded.tsx`, `landing-bento.tsx`, and `landing-sections.tsx` contain existing marketing copy and illustrative product scenes. Source code shows the intended flows; claims need product and deployment verification before publishing.
- A policy being submitted is not the same as being issued. A campaign-level cost per issued policy is not the profit of one lead. Carrier statement matching and pre-dial screening require accurate states and caveats.

## Creative questions to investigate before another design

1. **The moment of clarity:** What can an agency owner finally see or decide because records are connected? Candidate: understanding which campaigns lead to issued policies. Confirm that the actual CRM supports the specific comparison shown.
2. **The moment of handoff:** How does a live call become someone's responsibility? The waiting time, partner, claim, and transition into the call are concrete source-backed details worth observing in the actual interface.
3. **A day in the agency:** What does the work feel like across an owner, an agent, and operations? This may make the site more human without relying on generic stock portraits.

These are research hypotheses, not approved page copy or a selected design. A distinct answer should guide the next visual study. The current homepage wording is preserved in `homepage-copy-source-snapshot.md`; dynamic catalog values are not captured in that source snapshot.

## Evaluation criteria for the next concept

- Within five seconds a new visitor can identify who Insurvas serves and what it helps them do.
- The visual hook grows out of a real insurance-agency problem and is understandable without explanatory labels about the design.
- A real or carefully reconstructed CRM moment is shown accurately, with sample information labeled. No real customer data or invented proof is used.
- There is one clear action and a sensible route to deeper product detail. Preserve the existing approved copy unless the user asks to change it.
- Motion reveals a change in state, relationship, or action; it never holds the page hostage. A reduced-motion version communicates the same information.
- Review at actual desktop and phone sizes and test with someone unfamiliar with the product before claiming the result is clear or persuasive.

## Remaining research

Inspect the actual CRM visually with authorized, representative sample data and capture a few moments: waiting transfer, taking a call, source/campaign, application status, policy, and commission matching. Study the rest of the Behance board at full size, and the motion behavior of selected references rather than assuming it from still frames. Verify prices, trial wording, any testimonials, and all product claims before publication. Ask the user for feedback on the eventual direction after this research, before product implementation.
