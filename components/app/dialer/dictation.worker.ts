/// <reference lib="webworker" />
/**
 * On-device dictation (owner 2026-10-27): the Whisper speech model, run in this worker in the
 * agent's own browser. The recorded audio never leaves the computer; the only download is the
 * model itself, once, which the browser then keeps. Used where the browser has no speech-to-text of
 * its own, or blocks it (Firefox, Brave, Opera).
 */
import { env, pipeline } from "@huggingface/transformers";

env.allowLocalModels = false;

const MODEL = "onnx-community/whisper-base";
type Transcriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string } | Array<{ text: string }>>;
let loading: Promise<Transcriber> | null = null;

function load() {
  loading ??= pipeline("automatic-speech-recognition", MODEL, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (event: { status?: string; progress?: number; file?: string }) => {
      if (event.status === "progress" && typeof event.progress === "number") self.postMessage({ type: "progress", file: event.file ?? "", progress: event.progress });
    },
  }) as unknown as Promise<Transcriber>;
  return loading;
}

self.onmessage = async (event: MessageEvent<{ type: "warm" } | { type: "transcribe"; id: number; audio: Float32Array; language: string }>) => {
  const message = event.data;
  try {
    const transcribe = await load();
    if (message.type === "warm") { self.postMessage({ type: "ready" }); return; }
    const out = await transcribe(message.audio, { chunk_length_s: 30, stride_length_s: 5, language: message.language, task: "transcribe" });
    const text = Array.isArray(out) ? out.map((part) => part.text).join(" ") : out.text;
    self.postMessage({ type: "done", id: message.type === "transcribe" ? message.id : 0, text: text.trim() });
  } catch (error) {
    loading = null;
    self.postMessage({ type: "error", id: message.type === "transcribe" ? message.id : 0, message: error instanceof Error ? error.message : String(error) });
  }
};
