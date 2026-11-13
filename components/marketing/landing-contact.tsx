"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Check } from "lucide-react";

import { MarketingCta } from "@/components/marketing/cta";
import { control, textareaControl } from "@/components/ui/field";
import styles from "@/components/marketing/landing-contact.module.css";

/**
 * The contact form (Umar, 4 Nov, A8.6): "How will people contact us? Contact form is missing." It
 * closes the page under the roadmap, on the same ground: here is where we are going, and if you
 * need something we have not built, tell us. Posts to /api/public/contact, which emails the
 * Insurvas inbox with Reply-To set to the visitor.
 *
 * The controls are the shared field classes (components/ui/field). Labels are written out here
 * rather than through `Field`, because `Field` title-cases them and the marketing site speaks in
 * sentence case (components/marketing/README.md).
 */
type FieldName = "name" | "email" | "agency" | "message";
type State = { status: "idle" | "sending" } | { status: "sent"; name: string; email: string } | { status: "error"; message: string; fields: Partial<Record<FieldName, string>> };

const EXAMPLES = ["A carrier or vendor feed we do not read yet", "A workflow your floor runs differently", "A question before you start a trial"];

export function LandingContact() {
  const [state, setState] = useState<State>({ status: "idle" });
  const sectionRef = useRef<HTMLElement>(null);

  // The section rises in as it is reached (manager, 2026-11-13): the heading, the line under it, the
  // three points and the form, one after another. It is armed only from here, once the page runs and
  // only while the section is still below the screen, so without JavaScript, under reduced motion, or
  // when the page opens at #contact, it is simply there.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (section.getBoundingClientRect().top < window.innerHeight * 0.85) return;
    section.dataset.reveal = "armed";
    const io = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      section.dataset.reveal = "in";
      io.disconnect();
    }, { rootMargin: "0px 0px -18% 0px" });
    io.observe(section);
    return () => io.disconnect();
  }, []);
  const fields = state.status === "error" ? state.fields : {};

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    setState({ status: "sending" });
    try {
      const response = await fetch("/api/public/contact", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      const body = (await response.json().catch(() => ({}))) as { error?: string; fields?: Partial<Record<FieldName, string>> };
      if (!response.ok) {
        setState({ status: "error", message: body.error ?? "We could not send that just now. Please try again shortly.", fields: body.fields ?? {} });
        return;
      }
      setState({ status: "sent", name: data.name?.trim().split(/\s+/)[0] ?? "", email: data.email?.trim() ?? "" });
      form.reset();
    } catch {
      setState({ status: "error", message: "We could not reach our server. Check your connection and try again.", fields: {} });
    }
  }

  const invalid = (name: FieldName) => (fields[name] ? { "aria-invalid": true, "aria-describedby": `contact-${name}-error` } : {});
  const error = (name: FieldName) => fields[name] && <span id={`contact-${name}-error`} className={styles.error}>{fields[name]}</span>;

  return (
    <section ref={sectionRef} id="contact" aria-labelledby="contact-title" className={styles.section}>
      {/* One centred column (manager, 2026-11-13): the ask on top, the form under it. */}
      <div className={styles.inner}>
        <div className={styles.ask}>
          <h2 id="contact-title" className={styles.heading} data-rise="" style={{ "--i": 0 } as CSSProperties}>Need something we have not built yet?</h2>
          <p className={styles.lede} data-rise="" style={{ "--i": 1 } as CSSProperties}>Tell us about your floor and what you need. A person on our team reads every request and answers by email.</p>
          <ul className={styles.examples}>
            {EXAMPLES.map((example, index) => <li key={example} data-rise="" style={{ "--i": 2 + index * 0.5 } as CSSProperties}><Check aria-hidden="true" />{example}</li>)}
          </ul>
        </div>

        <div className={styles.panel} data-rise="" style={{ "--i": 3.5 } as CSSProperties}>
          {state.status === "sent" ? (
            <div className={styles.sent} role="status">
              <span className={styles.sentMark} aria-hidden="true"><Check /></span>
              <h3>Thanks{state.name ? `, ${state.name}` : ""}. We have your request.</h3>
              <p>We will answer at {state.email || "the address you gave"}.</p>
              <button type="button" className={styles.again} onClick={() => setState({ status: "idle" })}>Send another request</button>
            </div>
          ) : (
            <form className={styles.form} onSubmit={submit} noValidate>
              <div className={styles.row}>
                <label className={styles.field}>
                  <span>Name</span>
                  <input name="name" autoComplete="name" required maxLength={120} className={control} {...invalid("name")} />
                  {error("name")}
                </label>
                <label className={styles.field}>
                  <span>Work email</span>
                  <input name="email" type="email" autoComplete="email" required maxLength={254} className={control} {...invalid("email")} />
                  {error("email")}
                </label>
              </div>
              <label className={styles.field}>
                <span>Agency <small>(optional)</small></span>
                <input name="agency" autoComplete="organization" maxLength={160} className={control} {...invalid("agency")} />
                {error("agency")}
              </label>
              <label className={styles.field}>
                <span>What do you need?</span>
                <textarea name="message" required rows={4} maxLength={4000} className={textareaControl} {...invalid("message")} />
                {error("message")}
              </label>
              {/* The honeypot: off-screen, out of the tab order, ignored by password managers. */}
              <label className={styles.trap} aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
              <div className={styles.foot}>
                <MarketingCta type="submit" disabled={state.status === "sending"}>{state.status === "sending" ? "Sending…" : "Send request"}</MarketingCta>
                {state.status === "error" && <p className={styles.formError} role="alert">{state.message}</p>}
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
