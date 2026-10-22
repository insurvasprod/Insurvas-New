import type { CSSProperties } from "react";

import { ISOTYPE_SLASHES, ISOTYPE_VIEWBOX, ISOTYPE_WAVES } from "@/components/marketing/isotype-paths";
import { LandingIntroGate } from "@/components/marketing/landing-intro-gate";
import { INTRO_WAIT, INTRO_WAIT_FORCED } from "@/components/marketing/intro-timing";
import { LandingIntroHighway } from "@/components/marketing/landing-intro-highway";
import styles from "@/components/marketing/landing.module.css";

/**
 * The landing intro (owner, 2026-10-13; short cut the same day: no panels, 2.5 s at most). On the first
 * visit of a session:
 *   1. 0–0.6 s — nine lines sweep in from both edges at three depths, all through the centre;
 *   2. 0.5–1.0 s — they pull into the centre as the mark's eight bands are traced, outermost first;
 *   3. 0.95–1.4 s — the bands fill, the ten slashes snap in, one sweep of light crosses the mark;
 *   4. 1.6–2.3 s — the mark flies onto the nav logo's isotype, measured to the pixel by the script
 *      below, while the ground dissolves to the page;
 *   5. 2.3–2.5 s — the nav logo fades in beneath it as it goes (site-header.module.css).
 * The mark is the isotype's exact paths.
 *
 * Pure CSS, so it can never hold the page hostage: if the script below never runs the overlay still
 * ends, invisible and click-through, at 2.5 s. The script decides whether to play it — once per tab
 * session — and measures the flight. LandingIntroGate covers arriving at `/` by a client link,
 * holds scrolling while it plays, and lets a click, key, wheel or touch (or Skip) jump to the flight.
 * Under reduced motion it is never shown. The hero waits for it through --intro-delay.
 *
 * This CSS shot is the fallback for the 3D "Data Highway" shot (LandingIntroHighway): eight lanes of
 * light the camera rides and then rises above, until they read as the mark — 2.5 s, no cards. The
 * 3D shot is the one meant to play (owner, 2026-10-22: "make that moving lines into the logo"), so
 * the intro starts held on its blank first frame (html.intro-wait) while the scene loads, for at most
 * INTRO_WAIT ms; the 3D shot then plays from its start. Only if it is not ready by then (a slow
 * device, no WebGL) does this CSS shot play instead. `/?intro=3d` replays it and waits longer.
 */
// Plays once per tab session, from the top of the page (html.intro-play). It measures where the mark
// sits and where the nav logo's isotype is, for the flight (--fly-x/y/s, re-measured on resize), and
// holds the intro on its first frame (html.intro-wait) until the 3D shot takes over. If that has not
// happened by the wait's end, it lets the CSS shot play and retires the overlay 2.6 s later; the 3D
// shot retires it itself as its mark lands, and this steps in 4.2 s after the wait only as a last
// resort. `?intro=3d` replays the shot for review.
const SEEN = `try{window.__insurvasIntro=true;var h=document.documentElement;var f=/[?&]intro=3d/.test(location.search);if(!f&&sessionStorage.getItem("insurvas-intro")||matchMedia("(prefers-reduced-motion: reduce)").matches){h.classList.add("intro-seen")}else{sessionStorage.setItem("insurvas-intro","1");h.classList.add("intro-play");if("scrollRestoration" in history)history.scrollRestoration="manual";scrollTo(0,0);function fly(){var l=document.querySelector('header a[href="/"] .insurvas-logo'),m=document.querySelector("[data-intro-stage]");if(!l||!m)return false;var b=l.getBoundingClientRect(),r=m.getBoundingClientRect(),k=Math.min(b.width/931.86,b.height/217.52),x=b.left+(b.width-931.86*k)/2,y=b.top+(b.height-217.52*k)/2+(412.35-433.47)*k,z=259.77*k;h.style.setProperty("--fly-x",(x+z/2-(r.left+r.width/2))+"px");h.style.setProperty("--fly-y",(y+z/2-(r.top+r.height/2))+"px");h.style.setProperty("--fly-s",String(z/r.width));return true}var n=0;(function t(){if(!fly()&&n++<120)requestAnimationFrame(t)})();addEventListener("resize",fly);h.classList.add("intro-wait");var w=f?${INTRO_WAIT_FORCED}:${INTRO_WAIT};setTimeout(function(){if(h.classList.contains("intro-3d")||h.classList.contains("intro-done"))return;h.classList.remove("intro-wait");setTimeout(function(){h.classList.add("intro-done")},2600)},w);setTimeout(function(){h.classList.add("intro-done")},w+4200)}}catch(e){}`;
type Depth = "far" | "mid" | "near";

// Nine ribbons. Each crosses the whole screen through its centre, where the mark forms; about half
// enter from the right. Depth sets weight, speed and softness (landing.module.css).
const FLOWS: Array<{ offset: number; depth: Depth; fromRight: boolean }> = [
  { offset: -300, depth: "far", fromRight: false },
  { offset: -220, depth: "near", fromRight: true },
  { offset: -140, depth: "mid", fromRight: false },
  { offset: -70, depth: "far", fromRight: true },
  { offset: 0, depth: "mid", fromRight: false },
  { offset: 70, depth: "near", fromRight: false },
  { offset: 140, depth: "far", fromRight: false },
  { offset: 220, depth: "mid", fromRight: true },
  { offset: 300, depth: "far", fromRight: true },
];

function flowPath(offset: number, fromRight: boolean) {
  const y0 = 450 + offset * 1.25;
  const y1 = 450 - offset * 1.1;
  return fromRight
    ? `M 1720 ${y0} C 1240 ${y0 - offset * 0.3}, 1040 450, 800 450 S 360 ${y1 + offset * 0.35}, -120 ${y1}`
    : `M -120 ${y0} C 360 ${y0 - offset * 0.3}, 560 450, 800 450 S 1240 ${y1 + offset * 0.35}, 1720 ${y1}`;
}

const DEPTHS: Depth[] = ["far", "mid", "near"];
const layerClass: Record<Depth, string> = { far: styles.introLayerFar, mid: styles.introLayerMid, near: styles.introLayerNear };
const startAt: Record<Depth, number> = { far: 0, mid: 40, near: 80 };
const delay = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

// Outermost band first, so the tracing closes in the way the ribbons do.
const WAVES = ISOTYPE_WAVES.map((wave, index) => ({ ...wave, index })).reverse();

export function LandingIntro() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: SEEN }} />
      <div data-landing-intro-root="">
      <div className={styles.intro} aria-hidden="true" data-landing-intro="">
        <span className={styles.introBackdrop} data-intro-backdrop="" />
        <span className={styles.introClock} data-intro-clock="" />
        <div className={styles.introCamera}>
          <svg className={styles.introFlows} viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
            <defs>
              <linearGradient id="intro-flow" x1="0" y1="0" x2="1600" y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0" className={styles.introFlowStopEdge} />
                <stop offset=".3" className={styles.introFlowStopGreen} />
                <stop offset=".5" className={styles.introFlowStopInk} />
                <stop offset=".7" className={styles.introFlowStopGreen} />
                <stop offset="1" className={styles.introFlowStopEdge} />
              </linearGradient>
            </defs>
            {DEPTHS.map((depth) => (
              <g key={depth} className={layerClass[depth]}>
                {FLOWS.filter((flow) => flow.depth === depth).map((flow, index) => {
                  const d = flowPath(flow.offset, flow.fromRight);
                  const style = delay(startAt[depth] + index * 30);
                  return (
                    <g key={flow.offset}>
                      {depth === "near" && <path d={d} pathLength={1} className={`${styles.introFlow} ${styles.introFlowHalo}`} style={style} />}
                      <path d={d} pathLength={1} className={styles.introFlow} style={style} />
                    </g>
                  );
                })}
              </g>
            ))}
          </svg>

          <div className={styles.introStage} data-intro-stage="">
            <span className={styles.introBloom} />
            <svg className={styles.introMark} viewBox={ISOTYPE_VIEWBOX}>
              <defs>
                {ISOTYPE_WAVES.map((wave, index) => (
                  <linearGradient key={index} id={`intro-wave-${index}`} x1={wave.x1} y1="542.24" x2={wave.x2} y2="542.24" gradientUnits="userSpaceOnUse">
                    {[0, 0.04, 0.19, 0.35, 0.5, 0.66, 0.83, 1].map((offset, stop) => <stop key={offset} offset={offset} className={styles[`introStop${stop}`]} />)}
                  </linearGradient>
                ))}
                <linearGradient id="intro-sweep" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" className={styles.introSweepEdge} />
                  <stop offset=".5" className={styles.introSweepCore} />
                  <stop offset="1" className={styles.introSweepEdge} />
                </linearGradient>
                <clipPath id="intro-mark-clip">
                  {ISOTYPE_WAVES.map((wave, index) => <path key={index} d={wave.d} />)}
                  {ISOTYPE_SLASHES.map((d, index) => <path key={`s${index}`} d={d} />)}
                </clipPath>
              </defs>
              {WAVES.map((wave, order) => (
                <path
                  key={wave.index}
                  d={wave.d}
                  pathLength={1}
                  className={styles.introWave}
                  fill={`url(#intro-wave-${wave.index})`}
                  stroke={`url(#intro-wave-${wave.index})`}
                  style={{ "--d": `${550 + order * 35}ms`, "--f": `${950 + order * 25}ms` } as CSSProperties}
                />
              ))}
              {ISOTYPE_SLASHES.map((d, index) => (
                <path key={index} d={d} className={styles.introSlash} style={delay(1150 + index * 20)} />
              ))}
              <g clipPath="url(#intro-mark-clip)">
                <g className={styles.introSweep}>
                  <rect x="160" y="380" width="70" height="330" fill="url(#intro-sweep)" transform="rotate(18 195 545)" />
                </g>
              </g>
            </svg>
          </div>
        </div>
        <LandingIntroHighway />
        <span className={styles.introVignette} data-intro-lens="" />
        <span className={styles.introGrain} data-intro-lens="" />
      </div>
      {/* The Skip button, outside the aria-hidden overlay so it can be reached; any key, click or
          wheel skips too. */}
      <LandingIntroGate skipClassName={styles.introSkip} />
      </div>
    </>
  );
}
