/**
 * How long the landing intro holds on its blank first frame (html.intro-wait) for the 3D Data Highway
 * shot to load before the CSS shot plays instead (owner, 2026-10-22). Shared by the page script in
 * LandingIntro and LandingIntroGate, so it lives outside both (a "use client" module's constants are
 * not values on the server).
 */
export const INTRO_WAIT = 1500;
/** `/?intro=3d` (review) waits longer: the point there is to see the 3D shot. */
export const INTRO_WAIT_FORCED = 4000;
