"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, MicOff } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Dictate into a note (owner 2026-11-06: "add dictation into the notes"). Speaks into the browser's own speech
 * recognition and hands each finished phrase to `onText`, which appends it to the field. Nothing is sent
 * anywhere by Insurvas; a browser without speech recognition shows no button.
 */
type Recognition = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
type RecognitionCtor = new () => Recognition;

const noSubscribe = () => () => {};
const hasSpeech = () => {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
};

export function DictateButton({ onText, label = "Dictate", compact = false, className }: { onText: (text: string) => void; label?: string; /** The mic alone, to sit inside a notes box (NoteField). */ compact?: boolean; className?: string }) {
  // Known only in the browser: the server draws no button, the browser draws it where speech is available.
  const supported = useSyncExternalStore(noSubscribe, hasSpeech, () => false);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);

  useEffect(() => () => rec.current?.stop(), []);

  if (!supported) return null;

  const toggle = () => {
    if (listening) { rec.current?.stop(); return; }
    const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition)!;
    const r = new Ctor();
    r.lang = navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i += 1) if (e.results[i].isFinal) onText(e.results[i][0].transcript.trim());
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  };

  return (
    <Button type="button" variant="ghost" size="sm" onClick={toggle} aria-pressed={listening} aria-label={listening ? "Stop dictating" : label} title={listening ? "Stop dictating" : label} className={className}>
      {listening ? <MicOff aria-hidden="true" className={listening ? "text-[var(--error-ink)]" : undefined} /> : <Mic aria-hidden="true" />}
      {compact ? null : listening ? "Stop" : label}
    </Button>
  );
}
