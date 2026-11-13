"use client";

import { useState } from "react";

import { ViewTabs } from "@/components/ui/view-tabs";
import { PanelWords, type Words } from "@/components/design/auth-art/panel-words";
import { InsurvasLogo } from "@/components/shared/insurvas-logo";
import { LineArt } from "@/components/design/auth-art/line-art";
import { GuillocheArt } from "@/components/design/auth-art/guilloche-art";
import { FloorArt } from "@/components/design/auth-art/floor-art";
import styles from "@/components/design/auth-art/art.module.css";

/**
 * Three studies for the brand panel beside sign-in, against the panel they would replace
 * (owner, 12 Nov: the road photograph is out; he wants something animated that means something,
 * is detailed and real, and is not generic). Development only — nothing here is wired into the
 * real auth screens.
 *
 * Each study is shown where it will actually live: beside the form, at the owner's 1536x826, at
 * the real proportion. A panel judged as a poster is a panel judged wrong.
 */

type Study = "photo" | "line" | "guilloche" | "floor";

const STUDIES: { id: Study; tab: string; title: string; thesis: string; meaning: string; craft: string; risk: string }[] = [
  {
    id: "photo",
    tab: "Today · the photograph",
    title: "Today: a stock aerial of a mountain road",
    thesis: "A bought photograph with a slow zoom on it.",
    meaning:
      "The road gestures at the brand's Data Highway idea, but it is a road in Utah: it says nothing about leads, calls or commissions, and the same photograph is on anyone else's page who paid for it.",
    craft: "A Ken Burns drift — the cheapest motion there is, and the giveaway that the panel is a placeholder.",
    risk: "None, which is the problem. It is safe and it is forgettable.",
  },
  {
    id: "line",
    tab: "A · The Line",
    title: "A · The Line",
    thesis: "A thirty-second exposure of the data highway. Every light is one lead.",
    meaning:
      "Leads come out of the vanishing point in lanes — a lane is a campaign — and accelerate past. Most run out of frame. A few slow, burn bright and stop: those issued, and each leaves a mark that stays on the plate before the night takes it back. It keeps the road the owner already approved and makes it the product's own.",
    craft:
      "The canvas is never cleared: each frame lays a thin wash of night over the last, so the tails are a true accumulation that dims the way film does, not drawn strokes. Heads are one soft sprite stamped thousands of times. Grain and a vignette over the top.",
    risk:
      "Light trails are a known move. This earns its keep through the accumulation, the depth and the one event that matters — the car that stops — rather than through more lights.",
  },
  {
    id: "guilloche",
    tab: "B · Guilloché",
    title: "B · Guilloché",
    thesis: "The engraving off a policy document, and the machine that cuts it never stops.",
    meaning:
      "Guilloché is the fine-line rosette on banknotes, bonds, share certificates and policies — the visual language of a written promise, which is the thing this company actually sells. The eccentrics drift, so the figure re-weaves and never repeats, and an inking pass runs round one line every few turns. The border rail and the counterfoil ticks are the rest of the security-print grammar.",
    craft:
      "The curve is the real one — an epitrochoid, a point on a circle rolling round a circle — nested thirty-four deep. The interference between those lines is what the eye reads as cut metal rather than as a drawn spiral. 0.75px lines, so it rewards a good screen.",
    risk:
      "Engraving can read as old money rather than as new software. It is kept modern by the near-black plate, the mint, and type that is unmistakably 2026 — but this is the direction to look hardest at.",
  },
  {
    id: "floor",
    tab: "C · The Floor",
    title: "C · The Floor",
    thesis: "The room the product runs, drawn as its own instrument.",
    meaning:
      "A plan of a sales floor. A lead arrives at the left edge, is routed to the seat that takes it, and the seat holds while the call is live. Most calls end quietly. Some end in a policy, and a second token leaves for the ledger at the right, where it stacks. It is “know what every lead cost you” as a picture: one lead, one route, one seat, one line in the ledger — and it is the audience's own world seen from above.",
    craft:
      "A small live simulation rather than a loop: the routes, the hold times and the ledger are running, so no two visits are the same. The trace along the foot is speed-to-lead, the number that floor actually watches.",
    risk:
      "The nearest thing to a dashboard, so it is the easiest to make busy. It stays art by keeping the seats abstract and the numbers out of it.",
  },
];

/** The four settings of the panel's words, and what each one is for. */
const WORDS: { key: Words; label: string; note: string }[] = [
  { key: "today", label: "Today's words", note: "As it ships: a caps kicker, the headline, a paragraph that says it again, a rule and a footnote. Four voices in a descending ladder." },
  { key: "one", label: "1 · One sentence", note: "The kicker and the paragraph go. What is left is the claim and the one line that makes it credible — two voices instead of four, with the accent serif on “lead”, which is the landing page's own move." },
  { key: "above", label: "2 · Lead line above", note: "The same information inverted: the small line first, out of uppercase, the claim under it, and nothing below it at all. The quietest of the three." },
  { key: "top", label: "3 · Top set", note: "The words move up under the logo and the picture takes the whole lower half, so the two stop competing for the same ground. The paragraph survives as one quiet line at the foot." },
];

export function AuthArtShowcase() {
  const [study, setStudy] = useState<Study>("line");
  const [words, setWords] = useState<Words>("one");
  const current = STUDIES.find((s) => s.id === study) ?? STUDIES[1];
  const currentWords = WORDS.find((w) => w.key === words) ?? WORDS[1];

  return (
    <div className={styles.page}>
      <p className={styles.eyebrow}>Design study · development only</p>
      <h2 className={styles.heading}>The panel beside sign-in</h2>
      <p className={styles.intro}>
        Three directions, against the photograph they would replace. Each one is running — give it a
        few seconds. The figures and the traffic are invented for the mockup; none of it is real
        data, and none of this is wired into the real sign-in.
      </p>

      <div className={styles.tabs}>
        <ViewTabs
          label="The words"
          tabs={WORDS.map((w) => ({ key: w.key, label: w.label }))}
          value={words}
          onChange={setWords}
        />
      </div>
      <div className={styles.tabs}>
        <ViewTabs
          label="The picture behind them"
          tabs={STUDIES.map((s) => ({ key: s.id, label: s.tab }))}
          value={study}
          onChange={setStudy}
        />
      </div>

      <div className={styles.screen}>
        <div className={styles.stage}>
          <div className={`${styles.panel} ${styles[study]}`}>
            {study === "photo" && <div className={styles.image} aria-hidden="true" />}
            {study === "line" && <LineArt />}
            {study === "guilloche" && <GuillocheArt />}
            {study === "floor" && <FloorArt />}
            <div className={styles.shade} aria-hidden="true" />
            <div className={styles.grain} aria-hidden="true" />
            <div className={styles.vignette} aria-hidden="true" />
            <span className={styles.logo}>
              <InsurvasLogo size="auth" tone="dark" />
            </span>
            <PanelWords words={words} />
            <span className={styles.badge}>Mockup</span>
          </div>
        </div>

        {/* The form is scenery: the real one's shape and type, so the panel is judged in place. */}
        <div className={styles.form} aria-hidden="true">
          <div className={styles.formInner}>
            <p className={styles.h1}>Welcome back</p>
            <p className={styles.sub}>Sign in to your Insurvas workspace.</p>
            <div className={styles.oauth}>Sign in with Google</div>
            <div className={styles.or}>or use your email</div>
            <div className={styles.field}>
              <span className={styles.label}>Email</span>
              <div className={styles.input} />
            </div>
            <div className={styles.field}>
              <span className={styles.label}>Password</span>
              <div className={styles.input} />
            </div>
            <div className={styles.cta}>Sign In</div>
            <p className={styles.formFoot}>New to Insurvas? Create an account · Partner portal</p>
          </div>
        </div>
      </div>

      <div className={styles.notes}>
        <h3>{currentWords.label}</h3>
        <p>{currentWords.note}</p>
        <h3>{current.title}</h3>
        <p>{current.thesis}</p>
        <dl>
          <dt>What it means</dt>
          <dd>{current.meaning}</dd>
          <dt>Why it looks built, not generated</dt>
          <dd>{current.craft}</dd>
          <dt>The risk</dt>
          <dd>{current.risk}</dd>
        </dl>
      </div>
    </div>
  );
}
