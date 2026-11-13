import styles from "./landing-intro.module.css";

/** Set once the intro has played in this tab, so it greets a visit and not every page load. */
const SEEN_KEY = "insurvas.intro.v1";

/**
 * The landing page's entrance (owner, 2026-11-13: "a short animation, a glow fade-in logo when you
 * enter the page", after clepso.io's). For about two seconds the page is covered by the hero's own
 * dark ground: the Insurvas mark lights up with a green glow, the wordmark opens out of it, the
 * promise fades up under it, and the cover dissolves into the hero, whose headline then rises
 * (landing-hero-entrance.tsx waits for it).
 *
 * The tiny inline script decides before the first paint, so there is never a flash of the page
 * before the cover: it plays once per tab session, and never under reduced motion or without
 * JavaScript (the cover is hidden unless the script says "play").
 */
export function LandingIntro() {
  const decide = `(function(){var r=document.currentScript.parentElement,s="play";try{if(matchMedia("(prefers-reduced-motion: reduce)").matches||sessionStorage.getItem("${SEEN_KEY}"))s="done";else sessionStorage.setItem("${SEEN_KEY}","1")}catch(e){}r.dataset.state=s;if(s==="play")document.documentElement.dataset.intro="play"})();`;
  return (
    <div className={styles.intro} data-state="done" suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: decide }} />
      <div className={styles.overlay} aria-hidden="true">
        <div className={styles.brand}>
          <span className={styles.clip}>
            {/* eslint-disable-next-line @next/next/no-img-element -- painted before hydration; next/image would wait for it */}
            <img src="/brand/insurvas-logo-on-dark.svg" alt="" width={932} height={218} className={styles.logo} fetchPriority="high" />
          </span>
        </div>
        <p className={styles.motto}>Know what every lead cost you.</p>
      </div>
    </div>
  );
}
