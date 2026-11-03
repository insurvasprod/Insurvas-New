// Window events between the agent sidebar and the top bar (Navigation A, 2026-10-28). The two are
// separate components in the shell layout; the sidebar's workspace card asks the bar, which owns the
// account menu and the workspace list, to open that menu at the workspace switch.
export const OPEN_WORKSPACES_EVENT = "insurvas:open-workspaces";

/** The cookie that remembers a collapsed sidebar, read by the shell layout so the page draws at the right width. */
export const NAV_COLLAPSED_COOKIE = "insurvas_nav";
