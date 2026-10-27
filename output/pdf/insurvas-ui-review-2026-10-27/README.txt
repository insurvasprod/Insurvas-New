INSURVAS - UI FOUNDATION REVIEW | 27 OCTOBER 2026

Send Insurvas-UI-Foundation-Review.pdf to management. It contains the recommendation,
matching light and dark mockups, and the measured color QA summary.

The four PNGs are standalone mockups for chat or email. They use actual embedded Inter
and exact specified palette values, rendered from the vector PDF; no AI image approximation.

Recommendation: consolidate the existing shadcn/ui + Radix foundation; use one compact
style, Inter and Lucide. Theme colors adapt by semantic role across light and dark mode.
The SaaS implementation has not been changed.

Library choice: official shadcn/ui components on the existing Radix base are the
recommended core. Shadcnblocks and Shadcn Studio offer optional larger layouts,
not a substitute for one local component standard. HeroUI would introduce a
different foundation and is not recommended for this existing application.
Sources: https://www.shadcnblocks.com/ and https://shadcnstudio.com/
https://heroui.com/en/docs/react/releases/v3-0-0

QA: see contrast-checks.csv and palette-and-contrast.json. Passing palette pairs are
not proof of full application accessibility or browser behavior. Disabled components
are excluded from the WCAG contrast assertion and use explicit colors.

Suggested message:
Please review the proposed shared UI foundation for Insurvas. The attached pack shows
matching light and dark component systems, including typography, button states, inputs,
cards, filters, menus and tables. The recommendation retains our existing shadcn/Radix
foundation, adopts Inter, and corrects button-label and theme contrast. We are reviewing
these shared standards before applying them to individual pages.
