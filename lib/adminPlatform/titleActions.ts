// Admin › Platform (admin round 1, 2026-11-18): a page whose buttons open state its client body holds (a dialog, an
// import panel) draws them on the frame's title line, and the body listens for these window events. Plain module, so a
// server page and a client body read the same names. components/admin/platform/title-action.tsx is the other half.

export const PLATFORM_ACTION = {
  registerVendor: "platform:compliance:register-vendor",
  importPack: "platform:disclosures:import-pack",
  addDisclosure: "platform:disclosures:add",
  markReviewed: "platform:calling-rules:mark-reviewed",
} as const;

export type PlatformAction = (typeof PLATFORM_ACTION)[keyof typeof PLATFORM_ACTION];
