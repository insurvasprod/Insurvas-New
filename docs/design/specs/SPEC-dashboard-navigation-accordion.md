# Dashboard navigation accordion

**Status:** Approved by the owner on 2026-10-28; implementation in progress.

## Problem

The desktop agent shell uses a 72px icon rail and opens each page group in a separate flyout. The
page links feel detached from their main section, and users lose the wider menu context while
navigating.

## Decision

- Replace the desktop icon rail and its hover/focus flyouts with a persistent, labeled sidebar.
- Keep the existing Home link, job groups, Settings link, menu labels, icons, route paths, and
  server-filtered menu data.
- Render each job group as an inline disclosure row with its existing page links nested beneath it.
- Keep at most one group expanded. The group containing the current route opens when the route
  changes; users can collapse it or open another group.
- Use the same accordion behavior in the mobile drawer.
- Keep the existing account control mounted in the sidebar's footer slot. Leave the top bar and all
  route guards, entitlements, and navigation destinations unchanged.
- At tablet widths, keep the labeled sidebar and its own scroll area. At mobile widths, use the
  existing menu button and drawer.

## UI details

- The sidebar uses the existing dark navigation surface and brand treatment.
- Show the full Insurvas wordmark in the top-left brand area.
- Add a desktop collapse control in the brand row. The compact state keeps a symbol logo and icon
  navigation; choosing a section while compact expands the sidebar and opens that section.
- Show the signed-in user's name beside the account avatar in the expanded footer; keep the avatar
  alone in the compact footer.
- Align the account control at the bottom with the navigation content.
- Group labels remain readable in sentence case, with a clear disclosure chevron.
- The open group and active page are distinct states; the active page keeps the existing green
  selection treatment.
- Nested pages remain ordinary links and retain keyboard focus, `aria-current`, and accessible
  disclosure state.
- No hover-open or detached panel remains on desktop.

## Scope and acceptance

- UI-only: `components/app/agent-sidebar.tsx` and the agent sidebar rules in `app/globals.css`, plus
  this local spec/plan. No API, data, permission, or backend changes.
- The desktop menu stays within the viewport with its own vertical scroll at short heights.
- Main content is offset by the visible desktop sidebar and uses the full width on mobile.
- Validate the signed-in dashboard at 1536×826, 1366×657, 1920×1030 and 375px, in light and dark.
- The current browser is signed out; browser validation may need a signed-in app session.
