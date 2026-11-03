"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * The landing page's 3D plumbing (2026-10-13). One hook every scene uses, so each object only says
 * what it draws:
 *  - a transparent WebGL canvas sized to its box (ResizeObserver), pixel ratio capped for phones;
 *  - it renders only while on screen and while the tab is in front;
 *  - under prefers-reduced-motion it draws one still frame and stops;
 *  - no WebGL (old device, blocked context) → nothing is drawn and the HTML around it still stands;
 *  - everything it created is disposed on unmount;
 *  - nothing follows the pointer (owner, 2026-10-13): each object moves on its own clock;
 *  - while the landing intro's 3D shot plays over the page (html.intro-3d, until its hand-off), it
 *    draws nothing, so only one WebGL scene is rendering at a time;
 *  - its shaders compile off the main thread where the browser can (compileAsync) before the first
 *    frame, and the canvas fades in on that frame, so an object never arrives with a hitch or a pop.
 * Colours come from the page's own CSS tokens, so the 3D follows the brand and the theme.
 */
export type SceneSetup = (ctx: {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  colour: (token: string, fallback: string) => THREE.Color;
}) => { tick?: (time: number, delta: number) => void; dispose?: () => void };

function readToken(token: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value || fallback;
}

export function useThreeScene(setup: SceneSetup, options: { fov?: number; z?: number } = {}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const setupRef = useRef(setup);
  const { fov = 35, z = 6 } = options;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      return; // no WebGL: the section stands without its 3D object
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.opacity = "0";
    renderer.domElement.style.transition = "opacity 500ms ease-out";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 100);
    camera.position.set(0, 0, z);
    const colour = (token: string, fallback: string) => new THREE.Color(readToken(token, fallback));
    const built = setupRef.current({ scene, camera, renderer, colour });

    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let visible = true;
    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) loop(); }, { threshold: 0 });
    io.observe(host);

    const clock = new THREE.Clock();
    let frame = 0;
    let running = false;
    let ready = false; // compiled
    let shown = false;
    const draw = () => {
      const delta = Math.min(clock.getDelta(), 0.05);
      built.tick?.(clock.elapsedTime, delta);
      renderer.render(scene, camera);
      if (!shown) { shown = true; renderer.domElement.style.opacity = "1"; }
    };
    function loop() {
      if (running || reduced || !ready) return;
      running = true;
      const root = document.documentElement;
      const coveredByIntro = () => root.classList.contains("intro-3d") && !root.classList.contains("intro-handoff") && !root.classList.contains("intro-done");
      const step = () => {
        if (!visible || document.visibilityState !== "visible") { running = false; return; }
        if (!coveredByIntro()) draw();
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    }
    const onVisibility = () => { if (document.visibilityState === "visible") loop(); };
    document.addEventListener("visibilitychange", onVisibility);

    let disposed = false;
    const compiling = renderer.compileAsync(scene, camera).catch(() => { /* compiled on the first draw instead */ });
    void compiling.then(() => {
      if (disposed) return;
      ready = true;
      clock.getDelta(); // the wait for the compile is not motion
      if (reduced) { clock.elapsedTime = 2; draw(); } else loop();
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      renderer.domElement.remove();
      // Free the GPU side only once a compile still in flight has settled: it polls these materials,
      // and three.js throws on every poll if they are gone (React's dev double-mount hit this).
      void compiling.then(() => {
        built.dispose?.();
        scene.traverse((object) => {
          const mesh = object as THREE.Mesh;
          mesh.geometry?.dispose?.();
          const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
          (Array.isArray(material) ? material : material ? [material] : []).forEach((item) => item.dispose());
        });
        renderer.dispose();
      });
    };
  }, [fov, z]);

  return hostRef;
}
