import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

import { ISOTYPE_SLASHES, ISOTYPE_WAVES } from "@/components/marketing/isotype-paths";

/**
 * "The Data Highway" (2026-10-13, docs/design/landing-intro-prompt-v2.md): the landing intro's 3D
 * shot. The road IS the logo — the isotype's eight bands, parsed from their exact SVG paths, lie
 * flat on the ground as eight lanes. The camera rides between the middle two from the mark's
 * last stroke, behind one lead (a point of green light); then it cranes up and back until it looks
 * straight down on the mark, framed to exactly the size and place where the page's SVG copy of it
 * takes over (landing-intro-highway.tsx). Short cut (owner, 2026-10-13): no gates or signs, and the
 * whole shot — ride, crane, mark, hand-off — in 2.5 s.
 *
 * Time is passed in from outside (the intro's CSS clock), so a skip or a stall simply moves it.
 */
export const HIGHWAY = { rideStart: 150, rideEnd: 1150, riseEnd: 1750, handoff: 1950, end: 2400 } as const;

const K = 0.1; // world units per SVG unit
const LOGO = { x: 69.58, y: 412.35, size: 259.77 };
const CX = LOGO.x + LOGO.size / 2;
const CY = LOGO.y + LOGO.size / 2;
const OFFSETS = [0, 0.04, 0.19, 0.35, 0.5, 0.66, 0.83, 1];
// The isotype files' own stops: the light cut, and the on-dark cut.
const STOPS = {
  light: ["#07d6a0", "#07c896", "#099f79", "#0a7c61", "#0b624e", "#0c4f41", "#0c4339", "#0d4037"],
  dark: ["#07d6a0", "#07d29d", "#08c896", "#08bf90", "#09b88b", "#09b388", "#09b086", "#09af85"],
};
const SLASH = "#0a8769";
// The ride is the mark's long last stroke — from just past the valley of its W up toward the tip —
// so the camera glides on one long rising straight instead of tumbling through the sharp turns.
// It stops short of the tip so there is still road ahead when the crane begins.
const RIDE_TO = 0.88;
const EYE = 1.1; // camera height over the road while riding: a low drone, not a dashcam

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (from: number, to: number, value: number) => { const t = clamp01((value - from) / (to - from)); return t * t * (3 - 2 * t); };
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

/* ── Lanes: the bands, in their gradient; while riding they glow and shimmer along their length ── */
const LANE_VERTEX = /* glsl */ `
  varying vec2 vSvg; varying float vDepth;
  void main() {
    vSvg = position.xy;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const LANE_FRAGMENT = /* glsl */ `
  uniform vec3 uStops[8]; uniform float uOffs[8]; uniform float uX1; uniform float uX2;
  uniform vec3 uGlow; uniform float uRide; uniform float uTime; uniform float uNear; uniform float uFar; uniform float uAlpha;
  varying vec2 vSvg; varying float vDepth;
  vec3 gradient(float t) {
    t = clamp(t, 0.0, 1.0);
    vec3 colour = uStops[0];
    for (int i = 1; i < 8; i++) {
      if (t >= uOffs[i - 1]) colour = mix(uStops[i - 1], uStops[i], clamp((t - uOffs[i - 1]) / max(uOffs[i] - uOffs[i - 1], 1e-4), 0.0, 1.0));
    }
    return colour;
  }
  void main() {
    vec3 base = gradient((vSvg.x - uX1) / (uX2 - uX1));
    // Pulses of light running along the lane the way the traffic goes (left to right, up the mark),
    // faster than the camera, so they overtake it. While riding the lanes are light, not paint.
    float shimmer = pow(0.5 + 0.5 * sin((vSvg.x - vSvg.y) * 0.16 - uTime * 36.0), 10.0);
    vec3 ride = mix(base, uGlow, 0.55) + uGlow * shimmer * 0.8;
    float fog = 1.0 - smoothstep(uNear, uFar, vDepth);
    gl_FragColor = vec4(mix(base, ride, uRide), uAlpha * mix(1.0, fog * (0.4 + 0.5 * shimmer), uRide));
    #include <colorspace_fragment>
  }
`;

/* ── The lead: one point of green light with a white-hot core ───────────────────────────────── */
const LEAD_VERTEX = /* glsl */ `
  uniform float uSize; uniform float uPR;
  void main() { gl_PointSize = uSize * uPR; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const LEAD_FRAGMENT = /* glsl */ `
  uniform vec3 uGlow; uniform float uAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float core = smoothstep(0.32, 0.0, d);
    float halo = pow(1.0 - d, 2.0) * 0.6;
    gl_FragColor = vec4(mix(uGlow, vec3(1.0), core * 0.7), (core + halo) * uAlpha);
    #include <colorspace_fragment>
  }
`;

function shapesOf(d: string) {
  const data = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`);
  return data.paths.flatMap((path) => SVGLoader.createShapes(path));
}

function resample(line: THREE.Vector2[], count: number) {
  const lengths = [0];
  for (let index = 1; index < line.length; index++) lengths.push(lengths[index - 1] + line[index].distanceTo(line[index - 1]));
  const total = lengths[lengths.length - 1];
  const out: THREE.Vector2[] = [];
  let segment = 1;
  for (let step = 0; step < count; step++) {
    const target = (total * step) / (count - 1);
    while (segment < line.length - 1 && lengths[segment] < target) segment++;
    const span = lengths[segment] - lengths[segment - 1] || 1;
    out.push(line[segment - 1].clone().lerp(line[segment], (target - lengths[segment - 1]) / span));
  }
  return out;
}

/** The middle of a band: its outline runs out along one edge and back along the other, from the
 * lower-left tip (least x) to the upper-right tip (most x); the centre line averages the two. */
function centreLine(shape: THREE.Shape, count = 220) {
  const points = shape.getSpacedPoints(900).slice(0, -1);
  const n = points.length;
  let left = 0;
  let right = 0;
  points.forEach((point, index) => { if (point.x < points[left].x) left = index; if (point.x > points[right].x) right = index; });
  const walk = (direction: 1 | -1) => { const out: THREE.Vector2[] = []; for (let index = left; ; index = (index + direction + n) % n) { out.push(points[index]); if (index === right) break; } return out; };
  const a = resample(walk(1), count);
  const b = resample(walk(-1), count);
  return a.map((point, index) => point.clone().add(b[index]).multiplyScalar(0.5));
}

const toWorld = (point: THREE.Vector2, y = 0) => new THREE.Vector3((point.x - CX) * K, y, (point.y - CY) * K);

export type Highway = { render: (time: number) => void; warm: () => Promise<void>; resize: () => void; dispose: () => void };

/** Gives the browser a turn between building steps, so the CSS shot playing meanwhile never stutters. */
const breathe = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

export async function createHighway(host: HTMLElement, options: { markSize: () => number; dark: boolean; token: (name: string, fallback: string) => string }): Promise<Highway | null> {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch {
    return null;
  }
  // Capped: the ride is full-screen and translucent, and its last frame is handed to an SVG anyway.
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  Object.assign(renderer.domElement.style, { width: "100%", height: "100%", display: "block" });
  host.appendChild(renderer.domElement);

  const glowHex = options.token("--primary", "#07d6a0");
  const glow = new THREE.Color(glowHex);
  const page = new THREE.Color(options.token("--color-page-bg", options.dark ? "#08110f" : "#f2f5f4"));

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(page, 4, 16);
  const narrow = window.innerWidth < 640;
  const camera = new THREE.PerspectiveCamera(narrow ? 50 : 38, 1, 0.05, 6000);

  // The logo, flat on the ground: SVG space (x right, y down) laid onto the XZ plane, centred.
  const logo = new THREE.Group();
  logo.rotation.x = Math.PI / 2;
  logo.scale.setScalar(K);
  logo.position.set(-CX * K, 0, -CY * K);
  scene.add(logo);

  const stops = (options.dark ? STOPS.dark : STOPS.light).map((hex) => new THREE.Color(hex));
  const shared = { uStops: { value: stops }, uOffs: { value: OFFSETS }, uGlow: { value: glow }, uRide: { value: 1 }, uTime: { value: 0 }, uNear: { value: 2 }, uFar: { value: 16 }, uAlpha: { value: 0 } };
  const edgeMaterial = new THREE.LineBasicMaterial({ color: glow, transparent: true, opacity: 0, depthWrite: false });
  const centres: THREE.Vector2[][] = [];
  for (const wave of ISOTYPE_WAVES) {
    await breathe();
    const shapes = shapesOf(wave.d);
    const material = new THREE.ShaderMaterial({ uniforms: { ...shared, uX1: { value: wave.x1 }, uX2: { value: wave.x2 } }, vertexShader: LANE_VERTEX, fragmentShader: LANE_FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    logo.add(new THREE.Mesh(new THREE.ShapeGeometry(shapes, 32), material));
    // Lane markings: each band's outline, lifted a hair off the road.
    for (const shape of shapes) {
      const outline = new THREE.BufferGeometry().setFromPoints(shape.getSpacedPoints(600).map((point) => new THREE.Vector3(point.x, point.y, -0.4)));
      logo.add(new THREE.LineLoop(outline, edgeMaterial));
    }
    centres.push(centreLine(shapes[0]));
  }
  await breathe();

  const slashMaterials: THREE.MeshBasicMaterial[] = [];
  const slashCentres: THREE.Vector2[] = [];
  ISOTYPE_SLASHES.forEach((d) => {
    const shapes = shapesOf(d);
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(SLASH), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    slashMaterials.push(material);
    logo.add(new THREE.Mesh(new THREE.ShapeGeometry(shapes, 16), material));
    const points = shapes[0].getPoints();
    slashCentres.push(points.reduce((sum, point) => sum.add(point), new THREE.Vector2()).multiplyScalar(1 / points.length));
  });

  // The road the camera rides: midway between the middle two lanes, with the mark's sharp turns
  // rounded off (a moving average) so the camera glides through them instead of whipping round.
  const centre = centres[3].map((point, index) => point.clone().add(centres[4][index]).multiplyScalar(0.5));
  const middle = centre.map((_, index) => {
    const from = Math.max(0, index - 14);
    const to = Math.min(centre.length - 1, index + 14);
    const sum = new THREE.Vector2();
    for (let k = from; k <= to; k++) sum.add(centre[k]);
    return sum.multiplyScalar(1 / (to - from + 1));
  });
  const road = new THREE.CatmullRomCurve3(middle.filter((_, index) => index % 6 === 0 || index === middle.length - 1).map((point) => toWorld(point)), false, "centripetal", 0.5);
  const Y = new THREE.Vector3(0, 1, 0);
  let valley = 0.5;
  let deepest = -Infinity;
  for (let step = 0; step <= 400; step++) {
    const at = 0.25 + (0.5 * step) / 400;
    const z = road.getPointAt(at).z;
    if (z > deepest) { deepest = z; valley = at; }
  }
  const RIDE_FROM = valley + 0.03;
  // Distances along the road, in world units, as fractions of it.
  const roadLength = road.getLength();
  const LOOK = 3.0 / roadLength; // where the camera looks
  const LEAD = 3.2 / roadLength; // where the lead rides: ahead, in the lower third of the frame
  const along = (fraction: number) => RIDE_FROM + (RIDE_TO - RIDE_FROM) * fraction;

  await breathe();
  // The lead.
  const leadGeometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
  const leadUniforms = { uSize: { value: 44 }, uPR: { value: pixelRatio }, uGlow: { value: glow }, uAlpha: { value: 0 } };
  const lead = new THREE.Points(leadGeometry, new THREE.ShaderMaterial({ uniforms: leadUniforms, vertexShader: LEAD_VERTEX, fragmentShader: LEAD_FRAGMENT, transparent: true, depthWrite: false, depthTest: false }));
  lead.renderOrder = 10;
  lead.frustumCulled = false; // one moving point: its bounds never follow it
  scene.add(lead);
  const rideEndLead = road.getPointAt(Math.min(1, RIDE_TO + LEAD)).add(new THREE.Vector3(0, 0.25, 0));
  const landing = slashCentres.map((centre) => toWorld(centre)).sort((a, b) => a.distanceTo(rideEndLead) - b.distanceTo(rideEndLead))[0] ?? rideEndLead;

  // Camera poses.
  const matrix = new THREE.Matrix4();
  const look = (eye: THREE.Vector3, target: THREE.Vector3, up: THREE.Vector3) => new THREE.Quaternion().setFromRotationMatrix(matrix.lookAt(eye, target, up));
  const ridePose = (u: number, progress: number) => {
    // A gentle S: the camera drifts across the lanes and back as it rides.
    const lateral = new THREE.Vector3().crossVectors(Y, road.getTangentAt(u).setY(0).normalize()).normalize();
    const sway = Math.sin(progress * Math.PI * 1.5) * (narrow ? 0.2 : 0.7); // less on a narrow phone, so signs stay in frame
    const eye = road.getPointAt(u).add(new THREE.Vector3(0, EYE, 0)).addScaledVector(lateral, sway);
    const target = road.getPointAt(Math.min(1, u + LOOK)).add(new THREE.Vector3(0, 0.45, 0)).addScaledVector(lateral, sway * 0.4);
    const forward = target.clone().sub(eye).normalize();
    const roll = Math.sin(progress * Math.PI * 2) * THREE.MathUtils.degToRad(2);
    return { eye, quaternion: look(eye, target, Y.clone().applyAxisAngle(forward, roll)) };
  };
  // Straight down on the mark, at the height that draws it at exactly the SVG copy's size.
  let topHeight = 200;
  const topQuaternion = () => look(new THREE.Vector3(0, topHeight, 0), new THREE.Vector3(), new THREE.Vector3(0, 0, -1));

  const resize = () => {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const size = options.markSize();
    topHeight = (LOGO.size * K * height) / (2 * size * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  };
  resize();

  const render = (time: number) => {
    const ignition = clamp01(time / 400);
    const rideProgress = clamp01((time - HIGHWAY.rideStart) / (HIGHWAY.rideEnd - HIGHWAY.rideStart));
    const u = along(easeInOutSine(rideProgress));
    const riseProgress = clamp01((time - HIGHWAY.rideEnd) / (HIGHWAY.riseEnd - HIGHWAY.rideEnd));
    const rise = easeInOutCubic(riseProgress);

    // Camera: ride, then crane up and back to straight down.
    if (riseProgress <= 0) {
      const pose = ridePose(u, rideProgress);
      camera.position.copy(pose.eye);
      camera.quaternion.copy(pose.quaternion);
    } else {
      const from = ridePose(RIDE_TO, 1);
      camera.position.set(from.eye.x * (1 - rise), EYE * Math.pow(topHeight / EYE, rise), from.eye.z * (1 - rise));
      camera.quaternion.copy(from.quaternion).slerp(topQuaternion(), easeInOutCubic(clamp01(riseProgress * 1.12)));
    }

    // The road arrives out of the distance, then the fog lifts for the crane.
    const reach = THREE.MathUtils.lerp(1.5, 26, 1 - Math.pow(1 - ignition, 3));
    const far = THREE.MathUtils.lerp(reach, 8000, smooth(0, 0.5, riseProgress));
    shared.uFar.value = far;
    shared.uNear.value = far * 0.3;
    if (scene.fog instanceof THREE.Fog) { scene.fog.far = far; scene.fog.near = far * 0.3; }
    shared.uTime.value = time / 1000;
    shared.uAlpha.value = smooth(0, 300, time);
    shared.uRide.value = 1 - smooth(0.15, 0.8, riseProgress);
    edgeMaterial.opacity = 0.9 * ignition * (1 - smooth(0, 0.6, riseProgress));

    // The lead rides ahead of the camera, then settles into the mark as one of its slashes.
    if (riseProgress <= 0) {
      lead.position.copy(road.getPointAt(Math.min(1, u + LEAD))).add(new THREE.Vector3(0, 0.25, 0));
      leadUniforms.uSize.value = 44;
      leadUniforms.uAlpha.value = smooth(50, 300, time);
    } else {
      const settle = easeInOutCubic(clamp01(riseProgress / 0.7));
      lead.position.copy(rideEndLead).lerp(landing, settle);
      leadUniforms.uSize.value = THREE.MathUtils.lerp(44, 10, settle);
      leadUniforms.uAlpha.value = 1 - smooth(0.62, 0.85, riseProgress);
    }
    slashMaterials.forEach((material, index) => { material.opacity = smooth(0.55 + index * 0.02, 0.8 + index * 0.02, riseProgress); });

    renderer.render(scene, camera);
  };

  const dispose = () => {
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      (Array.isArray(material) ? material : material ? [material] : []).forEach((item) => item.dispose());
    });
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };

  // Compile every shader and upload every buffer and texture before the shot starts, so the first
  // frames of the ride never stall on the GPU driver.
  const warm = async () => {
    // Compile in the background first (parallel shader compile where the GPU driver offers it), then
    // draw one frame to upload the geometry and the sign textures.
    try { await renderer.compileAsync(scene, camera); } catch { /* compiled by the first render instead */ }
    await breathe();
    render(0);
  };

  return { render, warm, resize, dispose };
}
