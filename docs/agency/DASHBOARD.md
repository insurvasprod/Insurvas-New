# Agency dashboard: critique and redesign (2026-11-03)

The owner asked, via /ui-taste (operate + polish), for the agency dashboard to hold everything an agency needs:
metrics, graphs, tables, and a way into every agency page. It is not Home. Home is the person's own day; this
page is the agency at a glance. Two more asks: give it its own sidebar icon, and drop the Agency rail so that
Producers is reached by a shortcut on the dashboard. Nothing is committed.

No image-generation tool was available. The target came from the brief, the
[foundation mockup](../design/foundation-v3/mockup.html) and the shared components, not from a generated image.

## What was wrong (before)

Each part of the old page, as rendered at 1440×900 on the demo agency (Ellery & Fields):

| Part | Problem |
|---|---|
| Agency rail (Dashboard, Producers) | About 200px of width spent on one link. It squeezed the producer table past 1280. |
| Sidebar icon | The same `layout-dashboard` grid as Home, so the two dashboards could not be told apart. |
| Title line | Only the agency's name. Seats had been dropped, with nothing in their place. |
| "Written" card | Labelled *Written* but showed *issued*, with *submitted* underneath. |
| "Your override" card | "Reported basis" was jargon. The way in was a tiny "Overrides" text link inside the card. |
| "At risk" card | Same tiny-link problem ("Lapse risk"). |
| "Needs you" card | Counted only expiring licences, yet its name promised everything. Producers who could not submit, contract levels to fix, pay issues, producers owing money, the review queue and complaints were missing. |
| (missing) Owed to producers | The payable-out figure was hidden inside the money bar. |
| (missing) Producer headcount | Not on the page. |
| (missing) Shortcuts | No way to reach Hierarchy, Payouts, Splits, Producer pay, Scorecards, Application review, Lead routing or Team & access. |
| "Who wrote it" chart | Fine as a picture, but it took 8 of 12 columns. |
| "Where the money went" | Fine. |
| Producers table | Names were not links. There was no route to the full roster. A "Reported" chip was crammed into the Balance header. |
| Expiring table | The most urgent work sat at the very bottom, with an empty-state card when nothing was expiring. |

## What it is now (after)

From top to bottom, in [`components/app/agency/agency-dashboard.tsx`](../../components/app/agency/agency-dashboard.tsx):

1. **Title line.** *Agency dashboard*, an (i) with the page's question, the agency name, the period switch and
   **Invite producer**: two controls, no more.
2. **Needs you.** One row of linked counts, drawn by Home's own `HomeAttention` so both dashboards speak alike. The
   most urgent come first:

   | Count | Opens | Source |
   |---|---|---|
   | Producers who can't submit | `/app/producers?status=blocked` | `/api/app/agency/steps` |
   | Licences and appointments expiring | the Expiring table below | dashboard API |
   | Open complaints | `/app/complaints` | `/api/app/compliance/steps` |
   | Contract levels to fix | `/app/hierarchy?issues=1` | `/api/app/commissions/steps` |
   | Producers who owe the agency | `/app/producer-payouts` | dashboard API |
   | Pay issues | `/app/discrepancies` | `/api/app/commissions/steps` |
   | Applications to review | `/app/application-review` | `/api/app/agency/review`, only for a reviewer |

   Each read runs under its page's own gate. A read that is refused or fails is simply left out.
3. **The strip.** Five figures, and each whole tile is the link to the rows behind it:

   | Figure | Opens | Line beneath |
   |---|---|---|
   | Issued | Scorecards | Submitted |
   | Override | Hierarchy | "What the agency keeps" |
   | Owed to producers | Producer payouts | How many owe you back |
   | At risk | Lapse risk | Clawed back |
   | Producers | the roster | Seats, or how many can't submit |

   A manager sees no agency money: no Override and no Owed.
4. **Agency tools.** One tile per agency page, Producers first: Hierarchy & overrides, Producer payouts, Commission
   splits, Producer pay, Producer scorecards, Application review, Lead routing, and (for the owner) Team & access.
   - Each tile is the menu item of the same key, so it shows only where the server-filtered menu offers that page.
     A plan, a role or a hidden page removes the tile along with the sidebar link.
   - A tile shows a live line where the page knows one: "4 producers · 15 of 25 seats", "39 levels to fix",
     "$282.64 owed", "10 to review".
   - The rows always fill: nine tiles sit three by three, eight sit four by two.
5. **Charts.** *Who wrote it* (7 columns) and *Where the money went* (5 columns), each linking to its full page.
6. **Producer standing.** Ranked by issued. A name opens the producer's record, using the new `producerId` field
   on the dashboard API rows. The header holds **All producers ›** and Refresh.
7. **Expiring inside 60 days.** Shown only when something expires. A name opens the right tab of the record.

## Around it

- **No rail.** `components/app/agency/agency-page.tsx` is now a plain title-line frame. The Producers pages trail
  back as "Home › Agency › Producers".
- **Its own icon.** `home.agency` now uses `building` (lucide Building2), the agency's building, in place of Home's grid.
- **Ratchet.** `lib/agency/agencyFlow.test.mjs` checks four things:
  - the page has no rail;
  - Producers is the first tile, and tiles follow the menu;
  - every strip figure is a link;
  - names open the record.

## Checked

- Walked as the demo owner at 1440×900 and 1280×800. Every table fits, and the page does not scroll sideways.
- Every chip, figure, tile and name was read back and links where it should.
- The Producers tile opens the roster at full width.
- Nothing was saved or sent.

## Not checked

- A manager's view, which should show their reports only, with no Override or Owed figures and no money tiles.
- A plan without some agency features, where tiles should drop out.
