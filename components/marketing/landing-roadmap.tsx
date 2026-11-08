"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ArrowRight } from "lucide-react";
import { createTimeline, svg } from "animejs";

import { ROADMAP, type RoadmapStatus } from "@/lib/marketing/roadmap";
import styles from "@/components/marketing/landing-roadmap.module.css";

/**
 * A glimpse of /roadmap (owner, 4 Nov), reworked after Umar's review (4 Nov, A8.3–A8.5): the road
 * photo stays, for the energy an image gives the page, but it is a short band now rather than a
 * full screen, pushed back under a dark green shade, with the heading and why we build over it. The
 * contact form follows on the same ground (`LandingContact`).
 *
 * The photo sits in a stage that keeps its proportions and is anchored to the band's bottom edge,
 * so the pins (percentages of the photo) stay on the asphalt at every width. Re-place them by eye if
 * the photo changes.
 *
 * Phones (owner, 6 Nov: one screen, no scrolling sideways, a road you have to travel to get
 * somewhere) have their own cut of the same top-down photo, tall, so the road snakes through the
 * whole screen: the stops sit on it in the order the road runs, shipped on the lowest pass and what
 * we are exploring at the foot of the climb out of the loop. The `p` fields place them there. Both
 * photos get the same treatment and the same dashed line (owner, 7 Nov). A phone has no room for
 * four labels at once, so there the label travels with the line: each opens as the line reaches its
 * stop, and once the line is drawn they take turns every few seconds, until the visitor taps one.
 */
type Tag = "above" | "below";
type Align = "start" | "center" | "end";
const STOPS: { status: RoadmapStatus; label: string; x: number; y: number; tag: Tag; align: Align; px: number; py: number; ptag: Tag; palign: Align }[] = [
  // Placed by the owner, 6 Nov, in the order the road runs: the lower road, the hairpin on the
  // right, back along the upper road to the hairpin on the left, and up through the loop.
  { status: "shipped", label: "Shipped", x: 20.1, y: 63.3, tag: "below", align: "start", px: 25, py: 78.25, ptag: "below", palign: "start" },
  { status: "progress", label: "Now", x: 95.5, y: 50.9, tag: "below", align: "end", px: 53.33, py: 68.1, ptag: "above", palign: "center" },
  { status: "planned", label: "Next", x: 33.9, y: 38.7, tag: "above", align: "center", px: 25, py: 44, ptag: "below", palign: "start" },
  { status: "exploring", label: "Exploring", x: 66.1, y: 35.3, tag: "below", align: "center", px: 80.17, py: 53, ptag: "below", palign: "end" },
];

/**
 * The road between the stops on the computer's photo, traced by eye in the photo's own pixels
 * (1600 x 864): one list per stretch, from one stop to the next. Re-trace if the photo changes.
 */
const ROUTE: Array<Array<[number, number]>> = [
  [[322, 547], [400, 575], [480, 618], [560, 662], [650, 698], [750, 718], [850, 718], [950, 702], [1050, 668], [1150, 632], [1250, 592], [1350, 548], [1440, 500], [1500, 468], [1528, 440]],
  [[1528, 440], [1515, 415], [1470, 405], [1400, 425], [1300, 460], [1200, 497], [1100, 535], [1000, 568], [900, 578], [800, 552], [700, 492], [620, 440], [565, 385], [542, 334]],
  [[542, 334], [560, 308], [620, 298], [720, 282], [800, 250], [860, 205], [910, 182], [945, 195], [958, 235], [930, 268], [880, 295], [852, 335], [862, 385], [905, 420], [980, 440], [1040, 428], [1075, 395], [1080, 350], [1058, 305]],
];

/** A smooth path through the points (Catmull-Rom as cubic Béziers), so the line follows the curves. */
function smooth(points: Array<[number, number]>): string {
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [points[i - 1] ?? points[i], points[i], points[i + 1], points[i + 2] ?? points[i + 1]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0]},${p2[1]}`;
  }
  return d;
}
const ROUTE_D = ROUTE.map(smooth);
/**
 * The same, on the phone's tall photo (1200 x 2000): along the lowest pass and off the right edge
 * round its hairpin, back left along the middle road, round the hairpin on the left, and up into
 * the loop, to the foot of the climb on the right.
 */
const ROUTE_TALL: Array<Array<[number, number]>> = [
  [[300, 1563], [400, 1586], [500, 1592], [600, 1584], [700, 1564], [800, 1540], [900, 1508], [1000, 1475], [1100, 1443], [1200, 1412], [1270, 1370], [1282, 1295], [1240, 1235], [1200, 1222], [1100, 1258], [1000, 1300], [900, 1335], [800, 1360], [700, 1365], [640, 1362]],
  [[640, 1362], [540, 1328], [440, 1280], [300, 1200], [160, 1080], [80, 990], [52, 935], [90, 902], [200, 890], [300, 880]],
  [[300, 880], [380, 860], [460, 830], [540, 790], [600, 750], [650, 715], [700, 700], [750, 712], [770, 760], [740, 810], [680, 850], [620, 890], [592, 960], [612, 1035], [680, 1085], [780, 1118], [860, 1130], [920, 1110], [962, 1060]],
];
const ROUTE_TALL_D = ROUTE_TALL.map(smooth);
const NOW = 1;
const TOUR_MS = 4_000;

export function LandingRoadmap() {
  const stops = STOPS.map((stop) => ({ ...stop, item: ROADMAP.find((item) => item.status === stop.status) })).filter((stop) => stop.item !== undefined);
  const [active, setActive] = useState(NOW);
  const touched = useRef(false);
  const [drawn, setDrawn] = useState(false);
  const [wait, setWait] = useState(0);

  // Once the band is in view, the first stop shows, then a dashed line runs along the road to the
  // next, which shows as it arrives, and so on to the last (owner, 6 Nov; on the phone too, 7 Nov).
  // Then the dashes keep moving along the road. Reduced motion shows it all at once.
  const sectionRef = useRef<HTMLElement>(null);
  const maskId = `route-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const phone = window.matchMedia("(max-width: 760px)").matches;
    const photo = phone ? "tall" : "wide";
    // On a phone the stop the line has reached is the one whose label shows.
    const reach = (i: number) => {
      pins[i]?.setAttribute("data-shown", "");
      if (phone && !touched.current) setActive(i);
    };
    const pins = [...section.querySelectorAll<HTMLElement>("[data-pin]")];
    const reveals = [...section.querySelectorAll<SVGPathElement>(`[data-reveal="${photo}"]`)];
    section.dataset.route = "waiting";
    let timeline: ReturnType<typeof createTimeline> | null = null;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting || timeline) return;
      io.disconnect();
      const SEG_MS = 1400;
      const tl = createTimeline({ defaults: { ease: "inOutSine" }, onComplete: () => { section.dataset.route = "done"; setDrawn(true); } });
      reveals.forEach((el) => { tl.set(svg.createDrawable(el), { draw: "0 0" }, 0); });
      tl.call(() => reach(0), 150);
      reveals.forEach((el, i) => {
        const at = 550 + i * (SEG_MS + 350);
        tl.add(svg.createDrawable(el), { draw: ["0 0", "0 1"], duration: SEG_MS }, at)
          .call(() => reach(i + 1), at + SEG_MS - 120);
      });
      timeline = tl;
    }, { threshold: 0.35 });
    io.observe(section);
    return () => { io.disconnect(); timeline?.revert(); delete section.dataset.route; pins.forEach((pin) => pin.removeAttribute("data-shown")); };
  }, []);

  // Phones, once the line is drawn: the labels take turns, while the band is on screen, until the
  // visitor taps a stop.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || !drawn || touched.current || !window.matchMedia("(max-width: 760px)").matches) return;
    const next = window.setTimeout(() => {
      const rect = section.getBoundingClientRect();
      if (rect.bottom > 0 && rect.top < window.innerHeight) setActive((i) => (i + 1) % STOPS.length);
      else setWait((n) => n + 1);
    }, TOUR_MS);
    return () => window.clearTimeout(next);
  }, [active, drawn, wait]);

  return (
    <section ref={sectionRef} id="roadmap" aria-labelledby="roadmap-title" className={styles.section}>
        {/* The white of the section above melts into the band (owner, 6 Nov). */}
        <div className={styles.fadeIn} aria-hidden="true" />
        {/* The header: the heading on the left, the why and the link on the right, on one baseline
            on a row of its own over the photo's faded top edge, so the pins below have the road to
            themselves (owner, 6 Nov). */}
        <div className={styles.over}>
          <div className={styles.titleBlock}>
            <p className={styles.eyebrow}>Roadmap</p>
            <h2 id="roadmap-title" className={styles.heading}>See what we are building next.</h2>
          </div>
          <div className={styles.aside}>
            {/* TO CONFIRM (Umar): the why. Same claim as the trust band, in one line. */}
            <p className={styles.why}>Insurvas is built by people who ran a final expense floor, and it grows from what agencies ask us for.</p>
            <Link href="/roadmap" className={styles.link}>See the full roadmap<ArrowRight aria-hidden="true" /></Link>
          </div>
        </div>
      <div className={styles.map}>
        <div className={styles.stage}>
          <Image src="/marketing/roadmap-road.webp" alt="" fill sizes="100vw" className={styles.photo} />
          <Image src="/marketing/roadmap-road-phone.webp" alt="" fill sizes="100vw" className={styles.photoTall} />
        </div>
        <div className={styles.shade} aria-hidden="true" />
        {/* A second stage of the same shape holds the pins, so they sit above the shade. */}
        <div className={styles.stage}>
          {/* The road from stop to stop, dashed, drawn on as the band comes into view. */}
          <svg className={styles.route} viewBox="0 0 1600 864" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="1600" height="864">
                {ROUTE_D.map((d) => <path key={d} d={d} className={styles.routeMask} data-reveal="wide" />)}
              </mask>
            </defs>
            <g mask={`url(#${maskId})`}>
              {ROUTE_D.map((d) => <path key={d} d={d} className={styles.routeCase} />)}
              {ROUTE_D.map((d) => <path key={d} d={d} className={styles.routeLine} />)}
            </g>
          </svg>
          <svg className={styles.routeTall} viewBox="0 0 1200 2000" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <mask id={`${maskId}t`} maskUnits="userSpaceOnUse" x="-100" y="0" width="1500" height="2000">
                {ROUTE_TALL_D.map((d) => <path key={d} d={d} className={styles.routeMask} data-reveal="tall" />)}
              </mask>
            </defs>
            <g mask={`url(#${maskId}t)`}>
              {ROUTE_TALL_D.map((d) => <path key={d} d={d} className={styles.routeCase} />)}
              {ROUTE_TALL_D.map((d) => <path key={d} d={d} className={styles.routeLine} />)}
            </g>
          </svg>
          <div className={styles.pins} role="group" aria-label="Roadmap stops">
            {stops.map((stop, i) => (
              <button
                key={stop.status}
                type="button"
                aria-pressed={active === i}
                className={styles.pin}
                data-status={stop.status}
                data-tag={stop.tag}
                data-align={stop.align}
                data-ptag={stop.ptag}
                data-palign={stop.palign}
                data-pin=""
                style={{ "--x": `${stop.x}%`, "--y": `${stop.y}%`, "--px": `${stop.px}%`, "--py": `${stop.py}%` } as CSSProperties}
                onClick={() => { touched.current = true; setActive(i); }}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
              >
                <span className={styles.node} aria-hidden="true" />
                <span className={styles.tag}><b>{stop.label} · {stop.item!.when}</b><span>{stop.item!.title}</span><span className={styles.detail}><span>{stop.item!.text}</span></span></span>
              </button>
            ))}
          </div>
        </div>
      </div>

    </section>
  );
}
