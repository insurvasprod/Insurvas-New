# Settings navigation hierarchy

## Goal

Make settings groups and the settings they contain easy to distinguish and scan.

## Behavior

- Every non-empty settings group is expanded when Settings opens.
- Each group can be collapsed or expanded independently.
- Selecting an in-page setting or opening a settings deep link reveals its containing group.
- Existing search, URL hashes, route links, access filtering, active selection, and panel content stay intact.
- Subsection entries indent beneath their group and share a vertical guide line with a short connector
  into each row; the guide uses the stronger border token in dark mode.
- On narrow screens, keep the grouped navigation in a bounded vertical scroll area so the active
  settings panel remains reachable below it.

## Scope

UI only in `components/app/agent-settings-tabs.tsx` and its styles in `app/globals.css`.
