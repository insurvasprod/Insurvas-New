"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

import { ROADMAP_STATUS, type roadmapGroups } from "@/lib/marketing/roadmap";
import styles from "@/components/marketing/roadmap-page.module.css";

type Group = ReturnType<typeof roadmapGroups>[number];

/**
 * The roadmap's trail, read as a journey (owner, 7 Nov: "when you scroll, things show up"). One rail
 * runs from the first stop to the last and fills with green as the reader goes down the page; each
 * stop lights as the fill reaches it, and each quarter's cards rise into place in a short stagger as
 * it comes into view.
 *
 * Nothing is hidden until this script runs (`data-motion` on the trail), so the page reads in full
 * without it. The fill is one element moved by `transform` alone, written straight onto it each frame,
 * so a phone holds a single moving layer. Reduced motion: the trail as it is, filled, still.
 */
export function RoadmapTrail({ groups }: { groups: readonly Group[] }) {
  const trailRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLSpanElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const trail = trailRef.current;
    const rail = railRef.current;
    const fill = fillRef.current;
    if (!trail || !rail || !fill || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    trail.dataset.motion = "on";
    const groupEls = [...trail.querySelectorAll<HTMLElement>("[data-group]")];
    const dots = groupEls.map((group) => group.querySelector<HTMLElement>("[data-dot]")).filter((dot): dot is HTMLElement => Boolean(dot));

    // The rail spans the first stop to the last; placed on resize, never animated. Measured by layout
    // offsets, which a stop's own rise (a transform) does not move.
    let top = 0;
    let height = 0;
    const offsetIn = (el: HTMLElement) => {
      let y = 0;
      for (let node: HTMLElement | null = el; node && node !== trail; node = node.offsetParent as HTMLElement | null) y += node.offsetTop;
      return y;
    };
    const centre = (dot: HTMLElement) => offsetIn(dot) + dot.offsetHeight / 2;
    const place = () => {
      if (dots.length < 2) return;
      top = centre(dots[0]);
      height = Math.max(1, centre(dots[dots.length - 1]) - top);
      rail.style.top = `${top}px`;
      rail.style.height = `${height}px`;
    };

    // The fill follows a reading line a little below the middle of the screen. A quarter rises once its
    // top passes a line near the foot of the screen, and stays; one scrolled past in a jump rises too.
    let frame = 0;
    const update = () => {
      frame = 0;
      const vh = window.innerHeight;
      const trailTop = trail.getBoundingClientRect().top;
      const line = vh * 0.62 - (trailTop + top);
      const progress = Math.min(1, Math.max(0, line / height));
      fill.style.transform = `scaleY(${progress.toFixed(4)})`;
      dots.forEach((dot, i) => {
        const at = i === 0 ? 0 : (centre(dot) - top) / height;
        dot.toggleAttribute("data-reached", progress >= at - 0.001 && line > -8);
      });
      groupEls.forEach((group) => {
        if (!group.hasAttribute("data-in") && trailTop + offsetIn(group) < vh * 0.88) group.dataset.in = "";
      });
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    const resize = () => { place(); schedule(); };
    place();
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", resize);
    // The rail's ends move once the brand font has loaded and the headings settle.
    void document.fonts?.ready.then(resize);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", resize);
      window.cancelAnimationFrame(frame);
      delete trail.dataset.motion;
      groupEls.forEach((group) => delete group.dataset.in);
      dots.forEach((dot) => dot.removeAttribute("data-reached"));
    };
  }, []);

  return (
    <div ref={trailRef} className={styles.trailWrap}>
      <span ref={railRef} className={styles.rail} aria-hidden="true"><span ref={fillRef} className={styles.railFill} /></span>
      <ol className={styles.trail}>
      {groups.map((group) => (
        <li key={group.key} className={styles.group} data-status={group.status} data-group="">
          <div className={styles.when}>
            <i aria-hidden="true" data-dot="" />
            <strong>{ROADMAP_STATUS[group.status].label}</strong>
            <span>{group.when}</span>
          </div>
          <ul className={styles.items}>
            {group.items.map((item, i) => (
              <li key={item.id} className={styles.item} style={{ "--i": i } as CSSProperties}>
                <p className={styles.itemTop}><strong>{item.title}</strong><em>{item.theme}</em></p>
                <p className={styles.itemText}>{item.text}</p>
              </li>
            ))}
          </ul>
        </li>
      ))}
      </ol>
    </div>
  );
}
