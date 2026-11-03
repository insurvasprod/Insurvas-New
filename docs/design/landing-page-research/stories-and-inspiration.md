# Landing page stories and inspiration

These are exploratory explanations, not replacement homepage copy. The original words are preserved in `homepage-copy-source-snapshot.md`.

## The story a 12-year-old can follow

An insurance agency pays to meet people who might need insurance. One person answers. An agent talks with them, helps them apply, and an insurance company decides whether to issue a policy. Later, the insurance company sends a statement showing what it paid the agency. Insurvas helps the agency keep those pieces together, so it can follow the journey and see what its leads cost when policies are issued.

Not every lead becomes a policy. The agency's checks and configuration matter, and a commission statement may need review. These are examples of a workflow, not a guarantee of an outcome.

## Different visitors, one story

- **New visitor:** “What is this?” It is a workspace for the people who buy leads, speak to customers, handle applications, and follow insurance business afterward.
- **Agency owner:** “Where is my money going?” Start at a campaign, follow the business it produces, and look at cost per issued policy from linked data. That figure is a cost, not profit.
- **Agent on a busy floor:** “What do I do next?” A transfer arrives, an agent claims it, and the relevant lead and application information is available for the work that follows.
- **Older or less technical visitor:** “Why should I care?” Instead of trying to remember which lead, call, policy, and payment belong together, the workspace helps keep the records connected.
- **Someone arriving from a social feed:** One clear question can earn attention: what happened to the leads the agency paid for? The next screen should answer it with a concrete example.
- **Someone arriving from LinkedIn:** Show the operational problem and an understandable record trail before asking for a trial or demo.

## A first visual direction: follow the record

Make a single insurance sale the visual subject. A lead record enters the page as a real working document. As the visitor moves down the page, that record develops into a transfer, application, policy, and carrier statement. The same visual thread connects them, so the visitor can follow the story without learning the interface first. Distinguish an individual record from campaign-level figures and label all invented names and values as sample data.

Use the existing homepage headline and wording in the mockup. Supporting details in an image concept are illustrative and must be checked against the saved copy and CRM before any implementation. A static concept can suggest motion; motion behavior is not verified by a still image.

## Research: what to take from references

| Source | Useful observation | Application to Insurvas |
| --- | --- | --- |
| [Mintlify on Lapa Ninja](https://www.lapa.ninja/post/mintlify-2/) | A full-page example to study for pacing and the relationship between product imagery and explanation. | Give each section a distinct job and make the product visible early. |
| [SaaSUI](https://www.saasui.design/) | A library of actual product interfaces organized by pattern. | Study real records, tables and workflows so illustrations resemble work agents recognize. |
| [AgentCompass](https://agentcompass.agency/marketing) | Explains agency work through concrete product modules and a short sequence. | Explain the journey in plain steps while giving Insurvas its own visual idea. |
| [iPipeline Agency Integrator](https://ipipeline.com/wp-content/uploads/2025/07/AGENCYINTEGRATOR_Slick_2025.pdf) | Presents quotes, underwriting, applications, agency management and analytics as connected stages. | Insurance operations have a natural story; use it to organize the page rather than listing features at random. |
| [Salesforce insurance brokerage](https://www.salesforce.com/financial-services/insurance-brokerage-management-software) | Describes matching carrier statements to policy records as a specific operational job. | Show a recognizable statement-to-policy connection, while verifying Insurvas's own behavior in its source. |

PowerHours and the supplied Behance board were not accessible to the research browser; the recording shows the board but does not expose every saved item. Further visual review of those references remains useful.

## Evidence and limits

The current `landing-exploded.tsx` depicts a sample transfer, lead source, pre-dial checks and application, while the marketing feature section describes policy-to-commission matching and True CPA. These sources establish a useful concept direction, not an independently verified production walkthrough. Do not reuse unverified customer claims, performance figures, or testimonials. Preserve sample labels and show no real customer data.
