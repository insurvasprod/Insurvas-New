import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import type { SceneSetup } from "./stage";

/**
 * The landing page's 3D objects (2026-10-13). Each is a SceneSetup for useThreeScene. Fallback
 * colours are only used if a CSS token cannot be read; the tokens are the source of truth.
 * Nothing here follows the pointer (owner, 2026-10-13): every object moves on its own clock.
 */
const FALLBACK = { olive: "#0d4037", green: "#07d6a0", mint: "#c5ffed", ink: "#0d4037", muted: "#5b6b67" };

/* ── The hero ribbon: silk strips, twisting through space ────────────────────────────────────── */
/*
 * One shared deformation (RIBBON_WARP) moves three things together, so they never drift apart:
 *   - the five silk strips: woven thread texture, fine grain, two inset pinstripes and a centre
 *     seam, a lit edge where a strip turns away, a specular streak, and slow glints running along;
 *   - fine filament lines riding between the strips (thin strands of the same silk);
 *   - small motes flowing along the strips, the leads moving through.
 * Everything stays in the brand greens from the tokens; nothing follows the pointer.
 */
const RIBBON_WARP = /* glsl */ `
  uniform float uTime;
  vec3 ribbonWarp(vec3 p, float offset, out float shade) {
    float t = uTime * 0.32 + offset * 1.7;
    float wave = sin(p.x * 0.55 + t) * 0.85 + sin(p.x * 1.25 - t * 1.4) * 0.3;
    float twist = sin(p.x * 0.33 + t * 0.6 + offset) * 1.25;
    float y = p.y * cos(twist);
    float z = p.y * sin(twist);
    shade = 0.5 + 0.5 * cos(twist);
    return vec3(p.x, y + wave + (offset - 2.0) * 0.32, z + cos(p.x * 0.4 + t) * 0.6 - offset * 0.3);
  }
`;
const RIBBON_VERTEX = /* glsl */ `
  uniform float uOffset;
  varying vec2 vUv; varying float vShade; varying vec3 vView;
  ${RIBBON_WARP}
  void main() {
    vUv = uv;
    vec3 p = ribbonWarp(position, uOffset, vShade);
    vec4 view = modelViewMatrix * vec4(p, 1.0);
    vView = view.xyz;
    gl_Position = projectionMatrix * view;
  }
`;
const RIBBON_FRAGMENT = /* glsl */ `
  uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform vec3 uLine; uniform float uOffset; uniform float uTime;
  varying vec2 vUv; varying float vShade; varying vec3 vView;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  /* A crisp line at v, as wide as w, antialiased by the screen-space footprint. */
  float hairline(float x, float v, float w) {
    float aa = fwidth(x) * 1.25;
    return 1.0 - smoothstep(w, w + aa, abs(x - v));
  }
  void main() {
    vec3 tone = mix(uB, uC, smoothstep(0.1, 1.0, vUv.x));
    vec3 col = mix(uA, tone, 0.3 + 0.7 * vShade);

    /* Woven silk: lengthwise threads that wander a little, a cross-weave, and fine grain. */
    float wander = noise(vUv * vec2(18.0, 3.0) + uOffset * 7.0) * 2.4;
    float threads = 0.5 + 0.5 * sin(vUv.y * 210.0 + wander);
    float weave = 0.5 + 0.5 * sin(vUv.x * 520.0 + vUv.y * 14.0);
    float grain = noise(vUv * vec2(1400.0, 60.0));
    col *= 0.78 + 0.16 * threads + 0.05 * weave + 0.08 * grain;

    /* A crisp hem on each edge, two inset pinstripes and a fainter centre seam. */
    float hem = hairline(vUv.y, 0.035, 0.006) + hairline(vUv.y, 0.965, 0.006);
    float stripes = hairline(vUv.y, 0.16, 0.004) + hairline(vUv.y, 0.84, 0.004);
    float seam = hairline(vUv.y, 0.5, 0.0015);

    /* Light: a surface normal from the screen derivatives, a lit edge where the strip turns away,
       and a narrow specular streak as it twists through the light. */
    vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
    vec3 v = normalize(-vView);
    float facing = abs(dot(n, v));
    float rim = pow(1.0 - facing, 3.0);
    vec3 l = normalize(vec3(0.35, 0.8, 0.55));
    float spec = pow(max(dot(reflect(-l, n), v), 0.0), 28.0) + pow(max(dot(reflect(-l, -n), v), 0.0), 28.0);

    /* Slow glints travelling along each strip, between the pinstripes. */
    float lane = 1.0 - smoothstep(0.08, 0.3, abs(vUv.y - 0.5));
    float glint = smoothstep(0.975, 1.0, 0.5 + 0.5 * sin(vUv.x * 34.0 - uTime * 1.6 + uOffset * 2.3)) * lane;

    float sheen = pow(vShade, 6.0) * 0.3;
    col += vec3(1.0) * (spec * 0.4 + rim * 0.14) + sheen;
    float lines = clamp(hem * 0.9 + stripes * 0.7 + seam * 0.35, 0.0, 1.0);
    col = mix(col, uLine, lines * 0.85);
    col += uC * glint * 0.85;

    float edge = smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.94, vUv.y);
    float fade = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
    float alpha = edge * fade * (0.74 - uOffset * 0.1);
    alpha = clamp(alpha + (lines * 0.45 + glint * 0.35) * fade, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }
`;
/* Filaments: hair-thin strands riding between the strips, brighter at their centre line. */
const FILAMENT_FRAGMENT = /* glsl */ `
  uniform vec3 uLine; uniform float uOffset; uniform float uTime;
  varying vec2 vUv; varying float vShade; varying vec3 vView;
  void main() {
    float core = 1.0 - smoothstep(0.0, 0.5, abs(vUv.y - 0.5));
    float fade = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
    float pulse = 0.65 + 0.35 * sin(vUv.x * 9.0 - uTime * 0.9 + uOffset * 4.0);
    gl_FragColor = vec4(uLine * (0.8 + 0.2 * vShade), core * fade * pulse * 0.6);
    #include <colorspace_fragment>
  }
`;
/* Motes: small points carried along the strips, each on its own lane and speed. */
const MOTE_VERTEX = /* glsl */ `
  uniform float uPR;
  attribute float aOffset; attribute float aLane; attribute float aSpeed; attribute float aSize;
  varying float vFade; varying float vShade;
  ${RIBBON_WARP}
  void main() {
    float x = mod(position.x + uTime * aSpeed + 8.0, 16.0) - 8.0;
    vec3 p = ribbonWarp(vec3(x, aLane * 0.75, 0.0), aOffset, vShade);
    vFade = smoothstep(-8.0, -4.0, x) * smoothstep(8.0, 4.0, x);
    vec4 view = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aSize * uPR * (6.0 / -view.z);
    gl_Position = projectionMatrix * view;
  }
`;
const MOTE_FRAGMENT = /* glsl */ `
  uniform vec3 uLine;
  varying float vFade; varying float vShade;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float disc = 1.0 - smoothstep(0.15, 0.5, d);
    gl_FragColor = vec4(uLine, disc * vFade * (0.5 + 0.4 * vShade));
    #include <colorspace_fragment>
  }
`;

/**
 * `surface` is what the ribbon is drawn over: "page" reads the page background (light or dark
 * theme); "night" is a dark panel whatever the theme (the sign-in pages' brand panel).
 */
function makeRibbonScene(surface: "page" | "night"): SceneSetup {
  return ({ scene, colour, renderer }) => {
    const shared = {
      uTime: { value: 0 },
      uA: { value: colour("--footer-bg", FALLBACK.olive) },
      uB: { value: colour("--primary", FALLBACK.green) },
      uC: { value: colour("--brand-100", FALLBACK.mint) },
      uLine: { value: new THREE.Color() },
    };
    // Fine lines need contrast with the page: a deep brand green on the light theme (mint would
    // vanish into the pale strips), the mint glowing additively on the dark one.
    const background = colour("--background", "#f3f5f7");
    const lightPage = surface === "page" && 0.2126 * background.r + 0.7152 * background.g + 0.0722 * background.b > 0.5;
    shared.uLine.value = lightPage ? shared.uB.value.clone().lerp(shared.uA.value, 0.55) : shared.uC.value.clone();
    const glow = lightPage ? THREE.NormalBlending : THREE.AdditiveBlending;
    const group = new THREE.Group();
    const disposables: Array<{ dispose: () => void }> = [];

    // The silk strips.
    const geometry = new THREE.PlaneGeometry(16, 0.75, 360, 12);
    disposables.push(geometry);
    for (let index = 0; index < 5; index++) {
      const material = new THREE.ShaderMaterial({
        uniforms: { ...shared, uOffset: { value: index } },
        vertexShader: RIBBON_VERTEX,
        fragmentShader: RIBBON_FRAGMENT,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      disposables.push(material);
      group.add(new THREE.Mesh(geometry, material));
    }

    // Filaments between and just outside the strips.
    const strand = new THREE.PlaneGeometry(16, 0.035, 360, 1);
    disposables.push(strand);
    for (const offset of [-0.45, 0.5, 1.45, 2.55, 3.5, 4.4]) {
      const material = new THREE.ShaderMaterial({
        uniforms: { ...shared, uOffset: { value: offset } },
        vertexShader: RIBBON_VERTEX,
        fragmentShader: FILAMENT_FRAGMENT,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: glow,
      });
      disposables.push(material);
      group.add(new THREE.Mesh(strand, material));
    }

    // Motes flowing along the strips.
    const random = seeded(29);
    const count = 220;
    const positions = new Float32Array(count * 3);
    const offsets = new Float32Array(count);
    const lanes = new Float32Array(count);
    const speeds = new Float32Array(count);
    const sizes = new Float32Array(count);
    for (let index = 0; index < count; index++) {
      positions[index * 3] = random() * 16 - 8;
      offsets[index] = Math.floor(random() * 5);
      lanes[index] = (random() - 0.5) * 0.9;
      speeds[index] = 0.35 + random() * 0.9;
      sizes[index] = 1.5 + random() * 3.5;
    }
    const moteGeometry = new THREE.BufferGeometry();
    moteGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    moteGeometry.setAttribute("aOffset", new THREE.BufferAttribute(offsets, 1));
    moteGeometry.setAttribute("aLane", new THREE.BufferAttribute(lanes, 1));
    moteGeometry.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
    moteGeometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    const moteMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: shared.uTime, uLine: shared.uLine, uPR: { value: renderer.getPixelRatio() } },
      vertexShader: MOTE_VERTEX,
      fragmentShader: MOTE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: glow,
    });
    disposables.push(moteGeometry, moteMaterial);
    group.add(new THREE.Points(moteGeometry, moteMaterial));

    group.rotation.set(-0.35, 0.15, -0.22);
    scene.add(group);
    return {
      tick: (time) => { shared.uTime.value = time; },
      dispose: () => { for (const item of disposables) item.dispose(); },
    };
  };
}

export const ribbonScene = makeRibbonScene("page");
export const ribbonNightScene = makeRibbonScene("night");

/* ── Inbound: a globe — land in dots, a graticule, and calls arcing between cities ───────────── */
const GLOBE_R = 1.25;

/** Depth-faded points (the land and the sea). World z > 0 faces the camera. */
const GLOBE_DOT_VERTEX = /* glsl */ `
  uniform float uPR; attribute float aSize; attribute float aLand;
  varying float vDepth; varying float vLand;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vDepth = smoothstep(-1.1, 1.1, world.z);
    vLand = aLand;
    vec4 mv = viewMatrix * world;
    gl_PointSize = aSize * uPR * (5.6 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const GLOBE_DOT_FRAGMENT = /* glsl */ `
  uniform vec3 uLand; uniform vec3 uSea;
  varying float vDepth; varying float vLand;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.32, d);
    vec3 col = mix(uSea, uLand, vLand);
    gl_FragColor = vec4(col, a * mix(0.3, 0.95, vLand) * (0.08 + 0.92 * vDepth));
    #include <colorspace_fragment>
  }
`;
/** Lines (graticule, orbit, arcs), faded by depth; arcs carry a pulse travelling along them. */
const GLOBE_LINE_VERTEX = /* glsl */ `
  attribute float aT; attribute float aSeed;
  varying float vDepth; varying float vT; varying float vSeed;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vDepth = smoothstep(-1.3, 1.3, world.z);
    vT = aT; vSeed = aSeed;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;
const GLOBE_LINE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor; uniform float uAlpha; uniform float uTime; uniform float uPulse;
  varying float vDepth; varying float vT; varying float vSeed;
  void main() {
    float head = fract(uTime * 0.28 + vSeed);
    float behind = head - vT;
    float pulse = uPulse * step(0.0, behind) * smoothstep(0.28, 0.0, behind);
    float alpha = (uAlpha + pulse) * (0.1 + 0.9 * vDepth);
    gl_FragColor = vec4(mix(uColor, vec3(1.0), pulse * 0.25), alpha);
    #include <colorspace_fragment>
  }
`;
/** City nodes: a bright core with a ring rippling out of it. */
const NODE_VERTEX = /* glsl */ `
  uniform float uPR; attribute float aPhase;
  varying float vDepth; varying float vPhase;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vDepth = smoothstep(-0.2, 0.9, world.z);
    vPhase = aPhase;
    vec4 mv = viewMatrix * world;
    gl_PointSize = 26.0 * uPR * (5.6 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const NODE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor; uniform float uTime;
  varying float vDepth; varying float vPhase;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float core = smoothstep(0.2, 0.1, d);
    float r = fract(uTime * 0.55 + vPhase);
    float ring = smoothstep(0.07, 0.0, abs(d - r)) * (1.0 - r);
    float a = (core + ring * 0.9) * vDepth;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;
/** A soft rim of light around the globe. */
const HALO_VERTEX = /* glsl */ `
  varying float vRim;
  void main() {
    vec3 n = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vRim = 1.0 - abs(dot(n, normalize(-mv.xyz)));
    gl_Position = projectionMatrix * mv;
  }
`;
const HALO_FRAGMENT = /* glsl */ `
  uniform vec3 uColor; varying float vRim;
  void main() {
    gl_FragColor = vec4(uColor, pow(vRim, 3.0) * 0.55);
    #include <colorspace_fragment>
  }
`;

function fibonacciPoint(index: number, count: number) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (index / (count - 1)) * 2;
  const r = Math.sqrt(1 - y * y);
  const theta = golden * index;
  return new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r);
}

/** A made-up but believable coastline: a few low-frequency waves over latitude and longitude. */
function isLand(direction: THREE.Vector3) {
  const lat = Math.asin(direction.y);
  const lon = Math.atan2(direction.z, direction.x);
  const value = Math.sin(lon * 2 + 0.6) * Math.cos(lat * 2.2) + 0.55 * Math.sin(lon * 5 + 1.3) * Math.sin(lat * 3 + 0.7) + 0.3 * Math.cos(lon * 9 - lat * 4);
  return value > 0.05 && Math.abs(lat) < 1.3;
}

/** A seeded random, so the globe is the same globe on every visit. */
function seeded(seed: number) {
  let state = seed;
  return () => { state = (state * 16807) % 2147483647; return (state - 1) / 2147483646; };
}

function lineMaterial(uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({ uniforms, vertexShader: GLOBE_LINE_VERTEX, fragmentShader: GLOBE_LINE_FRAGMENT, transparent: true, depthWrite: false });
}

export const callSphereScene: SceneSetup = ({ scene, renderer, colour }) => {
  const random = seeded(20261013);
  const pr = renderer.getPixelRatio();
  // The page's own text colour: dark ink on the light theme, near-white on the dark one.
  const ink = colour("--ink", FALLBACK.ink);
  const green = colour("--primary", FALLBACK.green);
  const globe = new THREE.Group();

  // Land and sea, as dots.
  const count = 5200;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const land = new Float32Array(count);
  const landPoints: THREE.Vector3[] = [];
  for (let index = 0; index < count; index++) {
    const direction = fibonacciPoint(index, count);
    const onLand = isLand(direction);
    positions.set([direction.x * GLOBE_R, direction.y * GLOBE_R, direction.z * GLOBE_R], index * 3);
    sizes[index] = onLand ? 2.3 : 1.2;
    land[index] = onLand ? 1 : 0;
    if (onLand) landPoints.push(direction);
  }
  const dots = new THREE.BufferGeometry();
  dots.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  dots.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  dots.setAttribute("aLand", new THREE.BufferAttribute(land, 1));
  globe.add(new THREE.Points(dots, new THREE.ShaderMaterial({
    uniforms: { uPR: { value: pr }, uLand: { value: ink }, uSea: { value: ink } },
    vertexShader: GLOBE_DOT_VERTEX, fragmentShader: GLOBE_DOT_FRAGMENT, transparent: true, depthWrite: false,
  })));

  // The graticule: parallels every 30°, meridians every 30°.
  const grid: number[] = [];
  const circle = (point: (angle: number) => THREE.Vector3) => {
    const steps = 160;
    for (let index = 0; index < steps; index++) {
      const a = point((index / steps) * Math.PI * 2);
      const b = point(((index + 1) / steps) * Math.PI * 2);
      grid.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  };
  const radius = GLOBE_R * 1.002;
  for (const lat of [-60, -30, 0, 30, 60]) {
    const phi = (lat * Math.PI) / 180;
    circle((angle) => new THREE.Vector3(Math.cos(angle) * Math.cos(phi) * radius, Math.sin(phi) * radius, Math.sin(angle) * Math.cos(phi) * radius));
  }
  for (let meridian = 0; meridian < 6; meridian++) {
    const lon = (meridian * Math.PI) / 6;
    circle((angle) => new THREE.Vector3(Math.cos(angle) * Math.cos(lon) * radius, Math.sin(angle) * radius, Math.cos(angle) * Math.sin(lon) * radius));
  }
  const gridGeometry = new THREE.BufferGeometry();
  gridGeometry.setAttribute("position", new THREE.Float32BufferAttribute(grid, 3));
  gridGeometry.setAttribute("aT", new THREE.Float32BufferAttribute(new Float32Array(grid.length / 3), 1));
  gridGeometry.setAttribute("aSeed", new THREE.Float32BufferAttribute(new Float32Array(grid.length / 3), 1));
  globe.add(new THREE.LineSegments(gridGeometry, lineMaterial({ uColor: { value: ink }, uAlpha: { value: 0.16 }, uTime: { value: 0 }, uPulse: { value: 0 } })));

  // Cities: nodes picked on land, each with a ripple.
  const nodeCount = 16;
  const nodes: THREE.Vector3[] = [];
  while (nodes.length < nodeCount && landPoints.length) {
    const candidate = landPoints[Math.floor(random() * landPoints.length)];
    if (nodes.every((node) => node.angleTo(candidate) > 0.35)) nodes.push(candidate.clone());
  }
  const nodeGeometry = new THREE.BufferGeometry();
  nodeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(nodes.flatMap((node) => node.clone().multiplyScalar(GLOBE_R * 1.01).toArray()), 3));
  nodeGeometry.setAttribute("aPhase", new THREE.Float32BufferAttribute(nodes.map(() => random()), 1));
  const nodeUniforms = { uPR: { value: pr }, uColor: { value: green }, uTime: { value: 0 } };
  globe.add(new THREE.Points(nodeGeometry, new THREE.ShaderMaterial({ uniforms: nodeUniforms, vertexShader: NODE_VERTEX, fragmentShader: NODE_FRAGMENT, transparent: true, depthWrite: false })));

  // Calls: arcs lifted off the surface between pairs of cities, a pulse running along each.
  const arcs: number[] = [];
  const arcT: number[] = [];
  const arcSeed: number[] = [];
  const pairs: Array<[number, number]> = [];
  for (let index = 0; index < nodes.length; index++) {
    const partner = (index + 1 + Math.floor(random() * (nodes.length - 1))) % nodes.length;
    pairs.push([index, partner]);
  }
  for (const [from, to] of pairs) {
    const a = nodes[from];
    const b = nodes[to];
    const angle = a.angleTo(b);
    const lift = 0.12 + 0.22 * (angle / Math.PI);
    const seed = random();
    const steps = 72;
    const point = (t: number) => {
      // Spherical interpolation between the two cities, raised in the middle.
      const s = Math.sin(angle);
      const direction = s < 1e-4 ? a.clone() : a.clone().multiplyScalar(Math.sin((1 - t) * angle) / s).add(b.clone().multiplyScalar(Math.sin(t * angle) / s));
      return direction.normalize().multiplyScalar(GLOBE_R * 1.01 + Math.sin(Math.PI * t) * lift);
    };
    for (let index = 0; index < steps; index++) {
      const t0 = index / steps;
      const t1 = (index + 1) / steps;
      arcs.push(...point(t0).toArray(), ...point(t1).toArray());
      arcT.push(t0, t1);
      arcSeed.push(seed, seed);
    }
  }
  const arcGeometry = new THREE.BufferGeometry();
  arcGeometry.setAttribute("position", new THREE.Float32BufferAttribute(arcs, 3));
  arcGeometry.setAttribute("aT", new THREE.Float32BufferAttribute(arcT, 1));
  arcGeometry.setAttribute("aSeed", new THREE.Float32BufferAttribute(arcSeed, 1));
  const arcUniforms = { uColor: { value: green }, uAlpha: { value: 0.22 }, uTime: { value: 0 }, uPulse: { value: 1 } };
  globe.add(new THREE.LineSegments(arcGeometry, lineMaterial(arcUniforms)));

  // A tilted orbit with a satellite on it, outside the globe.
  const orbit = new THREE.Group();
  const orbitLine: number[] = [];
  const orbitRadius = GLOBE_R * 1.22;
  for (let index = 0; index < 200; index++) {
    const a0 = (index / 200) * Math.PI * 2;
    const a1 = ((index + 1) / 200) * Math.PI * 2;
    orbitLine.push(Math.cos(a0) * orbitRadius, 0, Math.sin(a0) * orbitRadius, Math.cos(a1) * orbitRadius, 0, Math.sin(a1) * orbitRadius);
  }
  const orbitGeometry = new THREE.BufferGeometry();
  orbitGeometry.setAttribute("position", new THREE.Float32BufferAttribute(orbitLine, 3));
  orbitGeometry.setAttribute("aT", new THREE.Float32BufferAttribute(new Float32Array(orbitLine.length / 3), 1));
  orbitGeometry.setAttribute("aSeed", new THREE.Float32BufferAttribute(new Float32Array(orbitLine.length / 3), 1));
  orbit.add(new THREE.LineSegments(orbitGeometry, lineMaterial({ uColor: { value: green }, uAlpha: { value: 0.35 }, uTime: { value: 0 }, uPulse: { value: 0 } })));
  const satelliteGeometry = new THREE.BufferGeometry();
  satelliteGeometry.setAttribute("position", new THREE.Float32BufferAttribute([orbitRadius, 0, 0], 3));
  satelliteGeometry.setAttribute("aPhase", new THREE.Float32BufferAttribute([0.3], 1));
  const satellite = new THREE.Points(satelliteGeometry, new THREE.ShaderMaterial({ uniforms: nodeUniforms, vertexShader: NODE_VERTEX, fragmentShader: NODE_FRAGMENT, transparent: true, depthWrite: false }));
  orbit.add(satellite);
  orbit.rotation.set(0.5, 0, 0.32);

  // The halo sits outside the rotating globe, so it stays still while the world turns.
  const halo = new THREE.Mesh(new THREE.SphereGeometry(GLOBE_R * 1.04, 64, 64), new THREE.ShaderMaterial({ uniforms: { uColor: { value: green } }, vertexShader: HALO_VERTEX, fragmentShader: HALO_FRAGMENT, transparent: true, depthWrite: false }));

  const tilt = new THREE.Group();
  tilt.rotation.set(0.38, 0, -0.18);
  tilt.add(globe);
  scene.add(halo, tilt, orbit);
  return {
    tick: (time, delta) => {
      nodeUniforms.uTime.value = time;
      arcUniforms.uTime.value = time;
      globe.rotation.y += delta * 0.09;
      const angle = time * 0.35;
      satellite.position.set(Math.cos(angle) * orbitRadius - orbitRadius, 0, Math.sin(angle) * orbitRadius);
    },
  };
};

/* ── Compliance: a heater shield with a lit rim, a check, and a scan passing down it ─────────── */
function shieldShape(scale = 1) {
  const s = (x: number, y: number) => [x * scale, y * scale] as const;
  const shape = new THREE.Shape();
  shape.moveTo(...s(0, 1.1));
  shape.quadraticCurveTo(...s(0.55, 1.14), ...s(1.02, 1.3));
  shape.quadraticCurveTo(...s(1.06, 0.7), ...s(1.0, 0.12));
  shape.bezierCurveTo(...s(0.95, -0.62), ...s(0.48, -1.12), ...s(0, -1.5));
  shape.bezierCurveTo(...s(-0.48, -1.12), ...s(-0.95, -0.62), ...s(-1.0, 0.12));
  shape.quadraticCurveTo(...s(-1.06, 0.7), ...s(-1.02, 1.3));
  shape.quadraticCurveTo(...s(-0.55, 1.14), ...s(0, 1.1));
  return shape;
}

function outlineCurve(shape: THREE.Shape, z: number) {
  const points = shape.getSpacedPoints(240).slice(0, -1).map((point) => new THREE.Vector3(point.x, point.y, z));
  return new THREE.CatmullRomCurve3(points, true, "centripetal");
}

const SCAN_VERTEX = /* glsl */ `
  varying float vY;
  void main() { vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const SCAN_FRAGMENT = /* glsl */ `
  uniform float uTime; uniform vec3 uColor; varying float vY;
  void main() {
    float scanY = 1.3 - mod(uTime * 0.7, 3.6);
    float band = smoothstep(0.22, 0.0, abs(vY - scanY));
    gl_FragColor = vec4(uColor, band * 0.45);
    #include <colorspace_fragment>
  }
`;

export const shieldScene: SceneSetup = ({ scene, renderer, colour }) => {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  const olive = colour("--footer-bg", FALLBACK.olive);
  const green = colour("--primary", FALLBACK.green);
  // The tile behind the shield is ink in both themes, so its light accents stay fixed mint
  // (--brand-100 turns dark green in the dark theme).
  const mint = new THREE.Color(FALLBACK.mint);
  const shield = new THREE.Group();

  // The body: an extruded, bevelled heater shield in deep metallic green.
  const depth = 0.16;
  const body = new THREE.ExtrudeGeometry(shieldShape(), { depth, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 5, curveSegments: 48 });
  body.translate(0, 0, -depth / 2);
  shield.add(new THREE.Mesh(body, new THREE.MeshPhysicalMaterial({ color: olive.clone().lerp(green, 0.18), metalness: 0.65, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.15 })));
  const front = depth / 2 + 0.06;

  // The raised inner panel, lighter, framed by a fine mint line.
  const inner = shieldShape(0.8);
  const panel = new THREE.ExtrudeGeometry(inner, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 3, curveSegments: 48 });
  panel.translate(0, -0.02, front);
  shield.add(new THREE.Mesh(panel, new THREE.MeshPhysicalMaterial({ color: olive.clone().lerp(green, 0.45), metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.1 })));
  shield.add(new THREE.Mesh(new THREE.TubeGeometry(outlineCurve(inner, front + 0.05), 400, 0.012, 6, true), new THREE.MeshBasicMaterial({ color: mint, transparent: true, opacity: 0.7 })));

  // The lit rim around the edge.
  shield.add(new THREE.Mesh(new THREE.TubeGeometry(outlineCurve(shieldShape(1.035), front - 0.02), 480, 0.038, 10, true), new THREE.MeshStandardMaterial({ color: green, emissive: green, emissiveIntensity: 0.55, metalness: 0.3, roughness: 0.3 })));

  // The check, standing proud of the panel.
  const check = new THREE.CurvePath<THREE.Vector3>();
  const checkZ = front + 0.12;
  check.add(new THREE.LineCurve3(new THREE.Vector3(-0.42, 0.06, checkZ), new THREE.Vector3(-0.1, -0.28, checkZ)));
  check.add(new THREE.LineCurve3(new THREE.Vector3(-0.1, -0.28, checkZ), new THREE.Vector3(0.48, 0.42, checkZ)));
  shield.add(new THREE.Mesh(new THREE.TubeGeometry(check, 64, 0.075, 16, false), new THREE.MeshStandardMaterial({ color: green, emissive: green, emissiveIntensity: 0.7, metalness: 0.2, roughness: 0.25 })));
  for (const end of [new THREE.Vector3(-0.42, 0.06, checkZ), new THREE.Vector3(-0.1, -0.28, checkZ), new THREE.Vector3(0.48, 0.42, checkZ)]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 16), new THREE.MeshStandardMaterial({ color: green, emissive: green, emissiveIntensity: 0.7, roughness: 0.25 }));
    cap.position.copy(end);
    shield.add(cap);
  }

  // A scan of light passing down the face.
  const scanUniforms = { uTime: { value: 0 }, uColor: { value: mint } };
  const scan = new THREE.Mesh(new THREE.ShapeGeometry(shieldShape(0.97), 48), new THREE.ShaderMaterial({ uniforms: scanUniforms, vertexShader: SCAN_VERTEX, fragmentShader: SCAN_FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  scan.position.z = front + 0.06;
  shield.add(scan);

  // Motes rising around it.
  const motes = 70;
  const motePositions = new Float32Array(motes * 3);
  for (let index = 0; index < motes; index++) motePositions.set([(Math.random() - 0.5) * 3.4, Math.random() * 3.4 - 1.7, (Math.random() - 0.5) * 1.2], index * 3);
  const moteGeometry = new THREE.BufferGeometry();
  moteGeometry.setAttribute("position", new THREE.BufferAttribute(motePositions, 3));
  const moteField = new THREE.Points(moteGeometry, new THREE.PointsMaterial({ color: green, size: 0.028, transparent: true, opacity: 0.7, depthWrite: false }));

  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(2, 3, 4);
  const fill = new THREE.PointLight(green, 6, 8);
  fill.position.set(-2, -1, 2);
  shield.position.y = 0.1;
  scene.add(shield, moteField, key, fill, new THREE.AmbientLight(0xffffff, 0.25));
  return {
    tick: (time, delta) => {
      scanUniforms.uTime.value = time;
      shield.rotation.y = Math.sin(time * 0.45) * 0.42;
      shield.rotation.x = -0.06 + Math.sin(time * 0.3) * 0.04;
      shield.position.y = 0.1 + Math.sin(time * 0.8) * 0.04;
      for (let index = 0; index < motes; index++) {
        const y = motePositions[index * 3 + 1] + delta * 0.18;
        motePositions[index * 3 + 1] = y > 1.7 ? -1.7 : y;
      }
      moteGeometry.attributes.position.needsUpdate = true;
    },
    dispose: () => { environment.dispose(); pmrem.dispose(); },
  };
};

/* ── Commissions: a glossy policy card, turning slowly in the light ──────────────────────────── */
function cardFace(colours: { olive: string; green: string; mint: string }, font: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024; canvas.height = 640;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const gradient = ctx.createLinearGradient(0, 0, 1024, 640);
  gradient.addColorStop(0, colours.olive);
  gradient.addColorStop(0.62, colours.green);
  gradient.addColorStop(1, colours.mint);
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1024, 640);
  ctx.globalAlpha = 0.12; ctx.fillStyle = "white";
  for (let index = 0; index < 9; index++) { ctx.beginPath(); ctx.arc(860, 120, 120 + index * 70, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = "white"; ctx.stroke(); }
  ctx.globalAlpha = 1;
  ctx.fillStyle = "white";
  ctx.font = `600 64px ${font}`; ctx.fillText("insurvas", 72, 130);
  ctx.font = `500 30px ${font}`; ctx.globalAlpha = 0.85; ctx.fillText("ISSUED POLICY", 72, 400);
  ctx.globalAlpha = 1; ctx.font = `600 48px ${font}`; ctx.fillText("FE-20931  ·  $14,000", 72, 460);
  ctx.font = `500 30px ${font}`; ctx.globalAlpha = 0.85; ctx.fillText("Commission matched  +$612.00", 72, 560);
  return new THREE.CanvasTexture(canvas);
}

export const policyCardScene: SceneSetup = ({ scene, renderer, colour }) => {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  const palette = {
    olive: `#${colour("--footer-bg", FALLBACK.olive).getHexString(THREE.SRGBColorSpace)}`,
    green: `#${colour("--primary", FALLBACK.green).getHexString(THREE.SRGBColorSpace)}`,
    mint: `#${colour("--brand-100", FALLBACK.mint).getHexString(THREE.SRGBColorSpace)}`,
  };
  const font = getComputedStyle(document.body).fontFamily || "sans-serif";
  const face = cardFace(palette, font);
  if (face) { face.colorSpace = THREE.SRGBColorSpace; face.anisotropy = renderer.capabilities.getMaxAnisotropy(); }
  const geometry = new RoundedBoxGeometry(3.2, 2, 0.06, 6, 0.12);
  const front = new THREE.MeshPhysicalMaterial({ map: face ?? undefined, roughness: 0.28, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.12 });
  const card = new THREE.Mesh(geometry, front);
  scene.add(card);
  const light = new THREE.DirectionalLight(0xffffff, 1.4);
  light.position.set(2, 3, 4);
  scene.add(light, new THREE.AmbientLight(0xffffff, 0.4));
  return {
    tick: (time) => {
      card.rotation.y = Math.sin(time * 0.45) * 0.45;
      card.rotation.x = Math.sin(time * 0.3) * 0.12;
      card.position.y = Math.sin(time * 0.8) * 0.06;
    },
    dispose: () => { environment.dispose(); pmrem.dispose(); face?.dispose(); },
  };
};
