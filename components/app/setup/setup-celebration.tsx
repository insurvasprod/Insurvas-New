"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { playFor } from "@/lib/notify/sound";

/**
 * The moment setup is finished (owner, 2026-10-22: "make a celebration animation of completing the
 * setup and continue to work"). Shown once — on the first render that finds every step done or
 * skipped, the same render that stamps the walkthrough finished — then never again.
 *
 * Confetti is drawn on a canvas in the brand's own tokens and stops by itself; with reduced motion
 * asked for there is no confetti, only the card. "Continue to work" goes home and refreshes the
 * shell, so the "Get set up" item leaves the sidebar there and then.
 *
 * Built on the shared Dialog since the redesign (2026-10-24): its focus trap keeps Tab inside the
 * card and hands focus back on close, and Escape and the backdrop close it the same way as before
 * ("Review setup"). The chime goes through playFor, which already honours the person's sound
 * preferences (mute, the `win` switch, do-not-disturb, a live call), so nothing is re-checked here.
 */
export function SetupCelebration({ steps, done, audience }: { steps: number; done: number; audience: "owner" | "member" }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  // The canvas lives in the Dialog's portal, which mounts a render after this component, so a callback
  // ref flags it in state and the confetti effect waits for that.
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const attachCanvas = useCallback((element: HTMLCanvasElement | null) => {
    canvas.current = element;
    setCanvasReady(element !== null);
  }, []);
  const button = useRef<HTMLButtonElement>(null);

  const close = (goHome: boolean) => {
    if (!open) return;
    setOpen(false);
    if (goHome) router.push("/app/dashboard");
    else router.replace("/app/setup");
    router.refresh();
  };

  // Once, when shown. Escape and focus are the Dialog's now.
  useEffect(() => {
    if (!open) return;
    playFor("win");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when shown
  }, []);

  useEffect(() => {
    const element = canvas.current;
    if (!open || !element) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const context = element.getContext("2d");
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    const resize = () => {
      element.width = window.innerWidth * ratio;
      element.height = window.innerHeight * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    const styles = getComputedStyle(document.documentElement);
    const palette = ["--primary", "--success", "--info", "--warning"].map((name) => styles.getPropertyValue(name).trim()).filter(Boolean);
    // The brand's own tokens only; with none readable there is no confetti rather than off-brand colour.
    if (palette.length === 0) return;
    const colors = palette;
    const width = window.innerWidth;
    // Two bursts from the lower corners, arcing up and across.
    const pieces = Array.from({ length: 160 }, (_, index) => {
      const left = index % 2 === 0;
      const angle = (left ? -60 : -120) + (Math.random() - 0.5) * 50;
      const speed = 9 + Math.random() * 9;
      return {
        x: left ? width * 0.1 : width * 0.9,
        y: window.innerHeight * 0.85,
        vx: Math.cos((angle * Math.PI) / 180) * speed,
        vy: Math.sin((angle * Math.PI) / 180) * speed,
        size: 5 + Math.random() * 6,
        spin: Math.random() * Math.PI,
        turn: (Math.random() - 0.5) * 0.3,
        color: colors[index % colors.length],
        round: Math.random() < 0.3,
      };
    });
    const started = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      const elapsed = now - started;
      context.clearRect(0, 0, element.width, element.height);
      const fade = Math.max(0, 1 - Math.max(0, elapsed - 2600) / 900);
      for (const piece of pieces) {
        piece.vy += 0.32;
        piece.vx *= 0.99;
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.spin += piece.turn;
        context.save();
        context.globalAlpha = fade;
        context.translate(piece.x, piece.y);
        context.rotate(piece.spin);
        context.fillStyle = piece.color;
        if (piece.round) {
          context.beginPath();
          context.arc(0, 0, piece.size / 2, 0, Math.PI * 2);
          context.fill();
        } else {
          context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
        }
        context.restore();
      }
      if (fade > 0) frame = requestAnimationFrame(draw);
      else context.clearRect(0, 0, element.width, element.height);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [open, canvasReady]);

  if (!open) return null;

  // The canvas is portalled beside the Dialog and sits between its overlay (z-50) and its card
  // (z-[60]): confetti over the dimmed page, never over the words.
  return (
    <>
      <Dialog open={open} onOpenChange={(next) => { if (!next) close(false); }}>
        <DialogPortal>
          <canvas ref={attachCanvas} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[55] size-full" />
        </DialogPortal>
        <DialogContent
          showCloseButton={false}
          onOpenAutoFocus={(event) => { event.preventDefault(); button.current?.focus(); }}
          className="z-[60] block max-w-[420px] rounded-2xl bg-[var(--color-card)] p-8 text-center shadow-[0_24px_64px_-16px_rgba(16,20,26,.5)] sm:max-w-[420px]"
        >
          <span className="mx-auto mb-5 flex size-16 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--primary)_18%,transparent)] text-[var(--accent-ink)] motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-500">
            <Check className="size-8" strokeWidth={3} />
          </span>
          <DialogTitle className="text-title-sm font-semibold tracking-[-0.02em]">You&apos;re all set up</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-muted-foreground">
            {done === steps ? `All ${steps} steps are done.` : `${done} of ${steps} steps are done; the ones you skipped wait on Get set up.`}{" "}
            {audience === "owner"
              ? "Insurvas is ready for the way your agency works, and everything stays editable in Settings."
              : "You know your way around; your work is waiting."}
          </DialogDescription>
          <div className="mt-6 flex flex-col gap-2">
            <Button ref={button} type="button" onClick={() => close(true)}>Continue to work</Button>
            <Button type="button" variant="ghost" onClick={() => close(false)}>Review setup</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
