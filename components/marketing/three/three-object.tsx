"use client";

import { callSphereScene, policyCardScene, ribbonNightScene, ribbonScene, shieldScene } from "./scenes";
import { useThreeScene } from "./stage";

/**
 * One live 3D object in a box. Loaded with next/dynamic (ssr: false) from LandingObject, so
 * three.js is its own chunk, fetched after the page has painted — the words never wait for it.
 */
const SCENES = {
  ribbon: { setup: ribbonScene, fov: 30, z: 7 },
  "ribbon-night": { setup: ribbonNightScene, fov: 30, z: 7 },
  sphere: { setup: callSphereScene, fov: 35, z: 5.6 },
  shield: { setup: shieldScene, fov: 35, z: 5.4 },
  card: { setup: policyCardScene, fov: 35, z: 4.6 },
} as const;

export type LandingObjectKind = keyof typeof SCENES;

export default function ThreeObject({ kind }: { kind: LandingObjectKind }) {
  const { setup, fov, z } = SCENES[kind];
  const ref = useThreeScene(setup, { fov, z });
  return <div ref={ref} className="size-full" />;
}
