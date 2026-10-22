"use client";

import { useEffect, useRef } from "react";

import { ISOTYPE_SLASHES, ISOTYPE_VIEWBOX, ISOTYPE_WAVES } from "@/components/marketing/isotype-paths";
import styles from "@/components/marketing/landing.module.css";

/**
 * The Data Highway intro's conductor (2026-10-13, docs/design/landing-intro-prompt-v2.md; smoothness
 * pass the same day).
 *
 * The intro starts held on its blank first frame (html.intro-wait, set by LandingIntro's page script)
 * while this loads the 3D scene and compiles it. If that is done while the intro still waits, this
 * takes over and plays the shot from its start — `html.intro-3d` moves the overlay's safety fade and
 * the hero's entrance. If the wait runs out first (slow device, no WebGL), the CSS shot plays
 * instead and this stands down. `?intro=3d` replays it for review.
 *
 * Smoothness: once it takes over, this owns the clock. Time advances by each frame's real length but
 * never by more than 50 ms, so a hitch on the main thread (the page is still loading around it)
 * slows the shot for a frame instead of making it jump; every CSS animation of the intro and the hero
 * is paused and stepped to the same time, so nothing drifts apart. A skip (which moves the CSS clock)
 * is noticed and adopted. If frames stop altogether, a watchdog hands everything back to CSS, whose
 * own timeline then finishes the intro.
 *
 * At 3.6 s the scene is looking straight down on the mark at exactly the size of the SVG copy here;
 * the copy takes over (the real paths), takes a light sweep and a slow push-in, and at 4.3 s flies —
 * no overshoot — onto the nav logo's isotype, measured to the pixel. The nav logo is hidden until the
 * copy lands on it, then fades in underneath; the copy is removed only once the logo is fully there,
 * so the hand-over is invisible.
 */
const MAX_STEP = 50; // ms of intro time a single frame may advance
const FLIGHT = 430;
const FLIGHT_EASE = "cubic-bezier(.65,0,.35,1)";
const LANDED_FADE = 120;
// Where the isotype sits inside the full logo file (public/brand/insurvas-logo.svg), in its units.
const WORDMARK = { x: 69.58, y: 433.47, width: 931.86, height: 217.52 };
const ISOTYPE = { x: 69.58, y: 412.35, size: 259.77 };

// Start fetching the scene the moment this script runs (well before hydration finishes), but only
// when an intro is going to play. three.js itself is shared with the hero's ribbon.
const early =
  typeof window !== "undefined" &&
  !document.documentElement.classList.contains("intro-seen") &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? import("@/components/marketing/three/highway").catch(() => null)
    : null;

function navMarkRect() {
  const logo = document.querySelector<HTMLElement>('header a[href="/"] .insurvas-logo');
  if (!logo) return null;
  const box = logo.getBoundingClientRect();
  const scale = Math.min(box.width / WORDMARK.width, box.height / WORDMARK.height);
  const left = box.left + (box.width - WORDMARK.width * scale) / 2 + (ISOTYPE.x - WORDMARK.x) * scale;
  const top = box.top + (box.height - WORDMARK.height * scale) / 2 + (ISOTYPE.y - WORDMARK.y) * scale;
  return { left, top, size: ISOTYPE.size * scale };
}

export function LandingIntroHighway() {
  const hostRef = useRef<HTMLDivElement>(null);
  const flyRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<SVGSVGElement>(null);
  const sweepRef = useRef<SVGGElement>(null);
  const bloomRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (root.classList.contains("intro-seen") || root.classList.contains("intro-done")) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const overlay = document.querySelector<HTMLElement>("[data-landing-intro-root]");
    const clockElement = document.querySelector<HTMLElement>("[data-intro-clock]");
    const hero = document.querySelector<HTMLElement>("[data-landing-hero]");
    const host = hostRef.current;
    if (!overlay || !clockElement || !host) return;
    const clockAnimation = () => clockElement.getAnimations().find((item) => item.timeline === document.timeline);
    const cssTime = () => {
      const time = clockAnimation()?.currentTime;
      return typeof time === "number" ? time : 0;
    };

    let cancelled = false;
    let frame = 0;
    let watchdog = 0;
    let dispose: (() => void) | null = null;
    let driven: Animation[] = [];
    const cleanups: Array<() => void> = [];
    // Hand every paused animation back to CSS at the time it has reached.
    const release = () => { driven.forEach((animation) => { try { animation.play(); } catch { /* finished or removed */ } }); driven = []; };
    // Too late once the wait is over: the CSS shot (or a skip) already has the stage.
    const waiting = () => root.classList.contains("intro-wait") && !root.classList.contains("intro-done");

    (async () => {
      let scene: typeof import("@/components/marketing/three/highway");
      let highway: import("@/components/marketing/three/highway").Highway | null;
      try {
        const loaded = await (early ?? import("@/components/marketing/three/highway"));
        if (!loaded) return;
        scene = loaded;
        if (cancelled || !waiting()) return;
        const style = getComputedStyle(root);
        highway = await scene.createHighway(host, {
          markSize: () => flyRef.current?.offsetWidth ?? 168,
          dark: root.classList.contains("dark"),
          token: (name, fallbackValue) => style.getPropertyValue(name).trim() || fallbackValue,
        });
        if (!highway) return;
        dispose = highway.dispose;
        await highway.warm();
      } catch {
        dispose?.();
        dispose = null;
        return; // the CSS intro carries on
      }
      if (cancelled || !highway) return;
      if (!waiting()) { highway.dispose(); dispose = null; return; }
      const shot = highway;
      const { HIGHWAY } = scene;

      // Take over, from the start. First pause every CSS animation of the intro and the hero (still held
      // at their first frame) — from here this owns the clock — then end the wait and switch modes, so
      // the CSS shot's crossfade-out (which the switch starts) runs on its own.
      driven = [...overlay.getAnimations({ subtree: true }), ...(hero?.getAnimations({ subtree: true }) ?? [])].filter((animation) => animation.timeline === document.timeline);
      let time = 0;
      driven.forEach((animation) => { animation.pause(); animation.currentTime = time; });
      root.classList.remove("intro-wait");
      root.classList.add("intro-3d");
      // The nav logo stays hidden until the flying copy lands exactly on it, then fades in beneath it.
      const navLogo = document.querySelector<HTMLElement>('header a[href="/"] .insurvas-logo');
      if (navLogo) { navLogo.style.transition = `opacity ${LANDED_FADE}ms ease`; navLogo.style.opacity = "0"; }
      const showNavLogo = () => { if (navLogo) navLogo.style.opacity = "1"; };
      cleanups.push(() => { showNavLogo(); window.setTimeout(() => { navLogo?.style.removeProperty("opacity"); navLogo?.style.removeProperty("transition"); }, LANDED_FADE + 50); });
      host.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-out", fill: "backwards" });
      const onResize = () => shot.resize();
      window.addEventListener("resize", onResize);
      cleanups.push(() => window.removeEventListener("resize", onResize));

      let revealed = false;
      let flown = false;
      let landedAt = 0;
      const reveal = () => {
        revealed = true;
        const fly = flyRef.current;
        if (fly) fly.style.opacity = "1";
        host.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: "ease-out", fill: "forwards" });
        markRef.current?.animate([{ transform: "scale(1)" }, { transform: "scale(1.03)" }], { duration: HIGHWAY.handoff - HIGHWAY.riseEnd, easing: "cubic-bezier(.33,0,.2,1)", fill: "forwards" });
        sweepRef.current?.animate([{ transform: "translateX(-200px)" }, { transform: "translateX(220px)" }], { duration: 320, delay: 0, easing: "cubic-bezier(.65,0,.35,1)", fill: "both" });
        bloomRef.current?.animate([{ opacity: 0, transform: "scale(.8)" }, { opacity: 1, transform: "scale(1)", offset: 0.45 }, { opacity: 0.4, transform: "scale(1.1)" }], { duration: 400, easing: "ease", fill: "forwards" });
      };
      const handOff = () => {
        flown = true;
        root.classList.add("intro-handoff"); // the hero's ribbon may draw again
        const fly = flyRef.current;
        const target = navMarkRect();
        // The ground dissolves to the hero; the lens (grain, vignette) and the bloom go with it.
        overlay.querySelectorAll<HTMLElement>("[data-intro-backdrop], [data-intro-lens]").forEach((element) => {
          element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: HIGHWAY.end - HIGHWAY.handoff, easing: "cubic-bezier(.65,0,.35,1)", fill: "forwards" });
        });
        bloomRef.current?.animate([{ opacity: 0.4 }, { opacity: 0 }], { duration: 200, fill: "forwards" });
        if (!fly) return;
        if (!target) {
          root.classList.add("intro-landed");
          showNavLogo();
          landedAt = performance.now();
          fly.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: "forwards" });
          return;
        }
        const box = fly.getBoundingClientRect();
        const size = box.width * 1.03; // the push-in it ends on
        const dx = target.left + target.size / 2 - (box.left + box.width / 2);
        const dy = target.top + target.size / 2 - (box.top + box.height / 2);
        const flight = fly.animate(
          [{ transform: "translate3d(0, 0, 0) scale(1)" }, { transform: `translate3d(${dx}px, ${dy}px, 0) scale(${target.size / size})` }],
          { duration: FLIGHT, easing: FLIGHT_EASE, fill: "forwards" },
        );
        // Landed: the nav logo fades in underneath the copy, which leaves only once it is fully there.
        flight.finished.then(() => {
          root.classList.add("intro-landed");
          showNavLogo();
          landedAt = performance.now();
          window.setTimeout(() => { fly.style.visibility = "hidden"; }, LANDED_FADE + 40);
        }).catch(() => { root.classList.add("intro-landed"); showNavLogo(); landedAt = performance.now(); });
      };

      let last = performance.now();
      let lastFrameAt = last;
      const finish = () => {
        cancelAnimationFrame(frame);
        window.clearInterval(watchdog);
        release();
        shot.dispose();
        dispose = null;
        showNavLogo();
        root.classList.add("intro-landed", "intro-done");
      };
      const loop = (now: number) => {
        lastFrameAt = now;
        // A skip moves the CSS clock forward: adopt it. Otherwise advance by this frame, capped.
        const external = cssTime();
        if (external > time + 40) time = external;
        time += Math.min(Math.max(0, now - last), MAX_STEP);
        last = now;
        for (const animation of driven) animation.currentTime = time;
        if (time < HIGHWAY.riseEnd + 300) shot.render(Math.min(time, HIGHWAY.riseEnd));
        if (!revealed && time >= HIGHWAY.riseEnd) reveal();
        if (!flown && time >= HIGHWAY.handoff) handOff();
        // Done once the copy has landed and the nav logo has faded in under it (or, at worst, 0.8 s
        // after the shot's end, when the overlay's own CSS safety fade begins).
        if ((landedAt && now - landedAt > LANDED_FADE + 80) || time >= HIGHWAY.end + 800) { finish(); return; }
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame((now) => { last = now; loop(now); });
      // If frames stop (a long block, a crash), give the intro back to CSS, which can finish it alone.
      watchdog = window.setInterval(() => {
        if (document.visibilityState === "visible" && performance.now() - lastFrameAt > 1500) {
          window.clearInterval(watchdog);
          cancelAnimationFrame(frame);
          release();
          showNavLogo();
          root.classList.add("intro-landed", "intro-handoff");
          window.setTimeout(() => root.classList.add("intro-done"), 1200);
        }
      }, 500);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.clearInterval(watchdog);
      cleanups.forEach((cleanup) => cleanup());
      release();
      dispose?.();
    };
  }, []);

  return (
    <div className={styles.highway}>
      <div ref={hostRef} className={styles.highwayCanvas} />
      <div ref={flyRef} className={styles.highwayMark}>
        <span ref={bloomRef} className={styles.highwayBloom} />
        <svg ref={markRef} viewBox={ISOTYPE_VIEWBOX} className={styles.highwayMarkSvg}>
          <defs>
            {ISOTYPE_WAVES.map((wave, index) => (
              <linearGradient key={index} id={`highway-wave-${index}`} x1={wave.x1} y1="542.24" x2={wave.x2} y2="542.24" gradientUnits="userSpaceOnUse">
                {[0, 0.04, 0.19, 0.35, 0.5, 0.66, 0.83, 1].map((offset, stop) => <stop key={offset} offset={offset} className={styles[`introStop${stop}`]} />)}
              </linearGradient>
            ))}
            <linearGradient id="highway-sweep" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" className={styles.introSweepEdge} />
              <stop offset=".5" className={styles.introSweepCore} />
              <stop offset="1" className={styles.introSweepEdge} />
            </linearGradient>
            <clipPath id="highway-clip">
              {ISOTYPE_WAVES.map((wave, index) => <path key={index} d={wave.d} />)}
              {ISOTYPE_SLASHES.map((d, index) => <path key={`s${index}`} d={d} />)}
            </clipPath>
          </defs>
          {ISOTYPE_WAVES.map((wave, index) => <path key={index} d={wave.d} fill={`url(#highway-wave-${index})`} />)}
          {ISOTYPE_SLASHES.map((d, index) => <path key={index} d={d} className={styles.highwaySlash} />)}
          <g clipPath="url(#highway-clip)">
            <g ref={sweepRef} style={{ transform: "translateX(-200px)" }}>
              <rect x="160" y="380" width="70" height="330" fill="url(#highway-sweep)" transform="rotate(18 195 545)" />
            </g>
          </g>
        </svg>
      </div>
    </div>
  );
}
