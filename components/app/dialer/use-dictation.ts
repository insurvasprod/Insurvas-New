"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Dictation for a note (owner 2026-10-27): speak instead of typing, or both. What is said is added
 * to the text, where it can be edited before it is saved; nothing is saved by speaking.
 *
 * Two engines, one button:
 * - "browser": the browser's own speech-to-text (Chrome, Edge, Safari): words appear as you speak.
 * - "device": the Whisper model in a worker, in the agent's own browser (dictation.worker.ts), for
 *   browsers without speech-to-text or that block it (Firefox, Brave, Opera). It records while the
 *   agent speaks and writes the text when they press Stop. The audio never leaves the computer; the
 *   model (about 77 MB) is downloaded once and the browser keeps it.
 * A browser whose own service fails (a "network" or "service-not-allowed" error) moves to the
 * device engine and remembers it.
 */

// The browser's speech-to-text (Web Speech API) is not in TypeScript's DOM types: the little we use.
type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<SpeechResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
};
type RecognitionCtor = new () => Recognition;
type Engine = "browser" | "device";

const ENGINE_KEY = "insurvas.dictation.engine";
const MAX_SECONDS = 180;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Which engine this browser should use: the browser's own where it truly works, else the model. */
function pickEngine(): Engine | null {
  if (typeof window === "undefined") return null;
  try { if (window.localStorage.getItem(ENGINE_KEY) === "device") return "device"; } catch { /* storage blocked: decide afresh */ }
  const nav = navigator as Navigator & { brave?: unknown };
  // Brave and Opera expose the API but block its service; they would only ever fail.
  const blocked = Boolean(nav.brave) || /\bOPR\//.test(navigator.userAgent);
  if (recognitionCtor() && !blocked) return "browser";
  const canRecord = typeof window.MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof window.Worker !== "undefined";
  return canRecord ? "device" : null;
}

function remember(engine: Engine) {
  try { window.localStorage.setItem(ENGINE_KEY, engine); } catch { /* not kept: the next visit tries the browser again */ }
}

// One model worker for the page, shared by every notes box.
let worker: Worker | null = null;
function modelWorker() {
  worker ??= new Worker(new URL("./dictation.worker.ts", import.meta.url), { type: "module" });
  return worker;
}

/** The recording as 16 kHz mono samples, what the model reads. */
async function toSamples(blob: Blob): Promise<Float32Array> {
  const context = new AudioContext({ sampleRate: 16000 });
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (decoded.numberOfChannels === 1) return decoded.getChannelData(0).slice();
    const mono = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const data = decoded.getChannelData(channel);
      for (let i = 0; i < data.length; i += 1) mono[i] += data[i] / decoded.numberOfChannels;
    }
    return mono;
  } finally {
    void context.close();
  }
}

const MIC_BLOCKED = "The microphone is blocked for this site. Allow it from the icon in the address bar, then press Dictate again.";

export function useDictation(onText: (text: string) => void) {
  const [engine, setEngine] = useState<Engine | null>(null);
  // Whether the browser has been asked yet: until then "no dictation here" is not known to be true.
  const [checked, setChecked] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [heard, setHeard] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [download, setDownload] = useState<number | null>(null);
  // Why dictation stopped or never started, said on the card (a toast is easy to miss mid-call).
  const [problem, setProblem] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTextRef = useRef(onText);
  useEffect(() => { onTextRef.current = onText; }, [onText]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- which engine works is only known in the browser
  useEffect(() => { setEngine(pickEngine()); setChecked(true); }, []);
  useEffect(() => () => {
    recognition.current?.abort();
    if (recorder.current?.state === "recording") recorder.current.stop();
    if (timer.current) clearInterval(timer.current);
  }, []);

  function startBrowser() {
    const Ctor = recognitionCtor();
    if (!Ctor || recognition.current) return;
    const r = new Ctor();
    r.lang = navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) onTextRef.current(result[0].transcript.trim());
        else interim += result[0].transcript;
      }
      setHeard(interim.trim());
    };
    r.onerror = (event) => {
      if (event.error === "network" || event.error === "service-not-allowed") {
        // The browser's service is not available here: use the on-device model from now on.
        remember("device");
        setEngine("device");
        setProblem("This browser's speech service is not available, so dictation now runs on this computer. Press Dictate again.");
        return;
      }
      const why: Record<string, string> = {
        "not-allowed": MIC_BLOCKED,
        "audio-capture": "No microphone was found. Plug one in or check it is not used by another app.",
        "language-not-supported": "Speech-to-text does not support this browser's language.",
      };
      if (event.error === "no-speech") setProblem("Nothing was heard. Press Dictate and speak a little louder.");
      else if (event.error !== "aborted") setProblem(why[event.error] ?? `Dictation stopped (${event.error.replaceAll("-", " ")}). Type the note instead.`);
    };
    r.onend = () => { recognition.current = null; setListening(false); setHeard(""); };
    recognition.current = r;
    setListening(true);
    try { r.start(); } catch { recognition.current = null; setListening(false); setProblem("Dictation could not start. Reload the page and try again."); }
  }

  async function startDevice() {
    if (recorder.current) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      setProblem(name === "NotAllowedError" || name === "SecurityError" ? MIC_BLOCKED : name === "NotFoundError" ? "No microphone was found. Plug one in and try again." : "The microphone could not be opened. Check it is not used by another app.");
      return;
    }
    // Start loading the model while the agent speaks, so the text comes sooner.
    const w = modelWorker();
    w.postMessage({ type: "warm" });
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
      recorder.current = null;
      setListening(false);
      if (chunks.length === 0) { setProblem("Nothing was recorded. Press Dictate and try again."); return; }
      setTranscribing(true);
      try {
        const audio = await toSamples(new Blob(chunks, { type: rec.mimeType }));
        const id = Date.now();
        const text = await new Promise<string>((resolve, reject) => {
          const onMessage = (event: MessageEvent<{ type: string; id?: number; text?: string; message?: string; progress?: number }>) => {
            const data = event.data;
            if (data.type === "progress" && typeof data.progress === "number") setDownload(Math.round(data.progress));
            else if (data.type === "done" && data.id === id) { w.removeEventListener("message", onMessage); resolve(data.text ?? ""); }
            else if (data.type === "error" && (data.id === id || data.id === 0)) { w.removeEventListener("message", onMessage); reject(new Error(data.message)); }
          };
          w.addEventListener("message", onMessage);
          w.postMessage({ type: "transcribe", id, audio, language: (navigator.language || "en").split("-")[0] === "es" ? "spanish" : "english" }, [audio.buffer]);
        });
        if (text) onTextRef.current(text);
        else setProblem("Nothing was heard. Press Dictate and speak a little louder.");
      } catch {
        setProblem("The speech model could not run here. Check the connection for its first download, then try again.");
      } finally {
        setTranscribing(false);
        setDownload(null);
      }
    };
    recorder.current = rec;
    setSeconds(0);
    setListening(true);
    rec.start(1000);
    timer.current = setInterval(() => setSeconds((value) => {
      if (value + 1 >= MAX_SECONDS && rec.state === "recording") rec.stop();
      return value + 1;
    }), 1000);
  }

  function start() {
    if (listening || transcribing) return;
    setProblem(null);
    if (engine === "browser") startBrowser();
    else if (engine === "device") void startDevice();
  }
  function stop() {
    recognition.current?.stop();
    if (recorder.current?.state === "recording") recorder.current.stop();
  }
  return { supported: engine !== null, checked, engine, listening, transcribing, heard, seconds, download, problem, start, stop };
}
