/**
 * Local Whisper transcription via transformers.js.
 *
 * Phase 2 of the audit implementation pass. Replaces the cloud-based
 * SpeechRecognition API in startVoice (MizanDashboard.tsx) with a fully
 * local pipeline:
 *
 *   Xenova/whisper-base.en (~140MB, downloaded once, cached by the browser
 *   in CacheStorage on first use).
 *
 * Why local: the previous path shipped the user's voice to whatever
 * speech-to-text backend the browser vendor ships (Google's, typically).
 * That conflicts with the product's "your behavior is data, not a
 * verdict" posture — voice notes about rehab pain or business uncertainty
 * should not leave the device.
 *
 * WebGPU is used when available (Chrome 113+, Edge, Safari 17+). Falls
 * back to WASM otherwise — slower but works everywhere. The first call
 * downloads the model; subsequent calls reuse the cached pipeline.
 *
 * The module exports a single `transcribe` function plus status types.
 * The React component owns the UI state — this module is deliberately
 * framework-free so it can be tested in isolation.
 */

export type VoiceProgress = {
  /** "downloading" fires repeatedly with 0..1 while the model pulls. */
  phase: "downloading";
  progress: number;
  file: string;
};

export type VoiceFailureReason =
  | "mic-denied"
  | "mic-unavailable"
  | "unsupported-browser"
  | "transcribe-failed";

export type TranscribeSuccess = {
  ok: true;
  text: string;
};

export type TranscribeFailure = {
  ok: false;
  reason: VoiceFailureReason;
  detail: string;
};

export type TranscribeResult = TranscribeSuccess | TranscribeFailure;

export type TranscribeOptions = {
  /** Fires with download progress so the UI can render "Downloading model (~140MB) — 47%". */
  onProgress?: (progress: VoiceProgress) => void;
};

// Module-scoped singleton. The pipeline is expensive to construct (~5s and
// a 140MB download on first call) so we keep one instance for the page
// lifetime. `pipeline()` itself memoizes by (task, model, device) but we
// also want to remember whether WebGPU init succeeded so fallback is
// sticky across calls.
type WhisperPipeline = {
  (audio: Float32Array): Promise<{ text: string }>;
};

type PipelineModule = typeof import("@huggingface/transformers");

let transformersPromise: Promise<PipelineModule> | null = null;
let pipelineCache: { pipeline: WhisperPipeline; device: "webgpu" | "wasm" } | null = null;

/**
 * Detect whether WebGPU is available. navigator.gpu can be missing on
 * older browsers, and "present" does not mean "working" — we still need
 * to request an adapter at runtime. We treat any failure as "use WASM."
 */
async function supportsWebGPU(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown | null> } }).gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

function loadTransformers(): Promise<PipelineModule> {
  // Dynamic import keeps transformers.js out of the server bundle —
  // it references `navigator`, `window`, etc. at module top level. The
  // dynamic import is only called from startVoice which is a client
  // event handler.
  if (!transformersPromise) {
    transformersPromise = import("@huggingface/transformers");
  }
  return transformersPromise;
}

async function getPipeline(onProgress?: (progress: VoiceProgress) => void): Promise<{
  pipeline: WhisperPipeline;
  device: "webgpu" | "wasm";
}> {
  if (pipelineCache) return pipelineCache;

  const tf = await loadTransformers();
  // onnxruntime-web's WASM binaries are not bundled — point them at the
  // CDN that ships the exact version transformers.js v3 expects. This
  // avoids a 12MB binary blob in our own bundle.
  tf.env.backends.onnx.wasm.wasmPaths =
    tf.env.backends.onnx.wasm.wasmPaths ||
    "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";

  const device = (await supportsWebGPU()) ? "webgpu" : "wasm";

  // The progress_callback shape from transformers.js v3 fires objects
  // like { status, file, progress, loaded, total }. We only care about
  // the "progress" status to update the percentage.
  const handleProgress = (event: { status?: string; file?: string; progress?: number }) => {
    if (event.status === "progress" && typeof event.progress === "number" && onProgress) {
      onProgress({
        phase: "downloading",
        progress: event.progress / 100,
        file: event.file ?? "model",
      });
    }
  };

  const created = (await tf.pipeline(
    "automatic-speech-recognition",
    "onnx-community/whisper-base.en",
    { device, progress_callback: handleProgress, dtype: device === "webgpu" ? "fp32" : "q8" },
  )) as unknown as WhisperPipeline;

  pipelineCache = { pipeline: created, device };
  return pipelineCache;
}

/**
 * Capture microphone audio as a Float32Array PCM buffer suitable for
 * transformers.js. MediaRecorder gives us a compressed Blob (webm/opus
 * by default); the pipeline accepts Blobs directly in v3, so we hand
 * it back as-is and let the library decode it.
 *
 * Returns the recorded Blob plus the underlying stream so the caller
 * can stop tracks cleanly.
 */
async function recordUntilStopped(signal: { aborted: boolean }): Promise<Blob> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new TranscribeError("unsupported-browser", "navigator.mediaDevices is unavailable.");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (err) {
    if (err instanceof DOMException) {
      if (err.name === "NotAllowedError" || err.name === "SecurityError") {
        throw new TranscribeError("mic-denied", "Microphone permission was denied.");
      }
      if (err.name === "NotFoundError" || err.name === "OverconstrainedError") {
        throw new TranscribeError("mic-unavailable", "No microphone device was found.");
      }
    }
    throw new TranscribeError("mic-unavailable", err instanceof Error ? err.message : "Microphone access failed.");
  }

  // Stop tracks as soon as the caller signals abort (e.g., user navigates
  // away mid-recording). Otherwise the red "recording" dot stays in the
  // browser tab forever.
  const stopTracks = () => stream.getTracks().forEach((track) => track.stop());
  const abortWatcher = window.setInterval(() => {
    if (signal.aborted) {
      stopTracks();
      window.clearInterval(abortWatcher);
    }
  }, 250);

  const mimeType = pickMimeType();
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const chunks: BlobPart[] = [];

  return new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      window.clearInterval(abortWatcher);
      stopTracks();
      resolve(new Blob(chunks, { type: mimeType ?? "audio/webm" }));
    };
    recorder.onerror = () => {
      window.clearInterval(abortWatcher);
      stopTracks();
      reject(new TranscribeError("mic-unavailable", "MediaRecorder failed mid-recording."));
    };
    recorder.start();
    // Caller flips signal.aborted = true to stop.
    const stopWatcher = window.setInterval(() => {
      if (signal.aborted) {
        if (recorder.state !== "inactive") recorder.stop();
        window.clearInterval(stopWatcher);
      }
    }, 100);
  });
}

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

/**
 * Read a recorded Blob into a Float32Array PCM buffer at 16kHz mono,
 * which is what whisper-base.en expects. transformers.js v3 can accept
 * a Blob / URL directly, but the decode path inside the library can be
 * flaky depending on the runtime — decoding here with the browser's
 * native AudioContext gives us a cleaner error surface and lets us
 * resample to 16kHz ourselves.
 */
async function decodeToPcm(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!;
  const ctx = new AudioCtx();
  try {
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    const sampleRate = decoded.sampleRate;
    const channel = decoded.getChannelData(0);
    if (sampleRate === 16000) return new Float32Array(channel);
    // Linear resample to 16kHz. Good enough for speech — whisper is robust
    // to mild interpolation artifacts. Avoids pulling in a resampler dep.
    const ratio = 16000 / sampleRate;
    const newLength = Math.floor(channel.length * ratio);
    const out = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const srcIndex = i / ratio;
      const lower = Math.floor(srcIndex);
      const upper = Math.min(lower + 1, channel.length - 1);
      const frac = srcIndex - lower;
      out[i] = channel[lower] * (1 - frac) + channel[upper] * frac;
    }
    return out;
  } finally {
    ctx.close();
  }
}

export class TranscribeError extends Error {
  reason: VoiceFailureReason;
  constructor(reason: VoiceFailureReason, detail: string) {
    super(detail);
    this.name = "TranscribeError";
    this.reason = reason;
  }
}

/**
 * Top-level entry point called by the React component. Records audio
 * until `signal.aborted` flips true, then transcribes it locally.
 *
 * The two-phase design (record, then transcribe) is deliberate — the
 * UI needs to swap from a "Recording… (tap to stop)" state to a
 * "Transcribing…" state, and folding both into one step would hide
 * that progress boundary from the user.
 */
export async function transcribe(
  signal: { aborted: boolean },
  options: TranscribeOptions = {},
): Promise<TranscribeResult> {
  try {
    const blob = await recordUntilStopped(signal);
    if (blob.size === 0) {
      return { ok: false, reason: "transcribe-failed", detail: "Recording was empty." };
    }
    const pcm = await decodeToPcm(blob);
    const { pipeline } = await getPipeline(options.onProgress);
    // transformers.js v3 ASR pipeline returns { text: string } or
    // { chunks: [...] } depending on options. We use the plain form.
    const result = (await pipeline(pcm)) as unknown as { text?: string };
    const text = (result?.text ?? "").trim();
    if (!text) {
      return { ok: false, reason: "transcribe-failed", detail: "Whisper produced no text." };
    }
    return { ok: true, text };
  } catch (err) {
    if (err instanceof TranscribeError) {
      return { ok: false, reason: err.reason, detail: err.message };
    }
    return {
      ok: false,
      reason: "transcribe-failed",
      detail: err instanceof Error ? err.message : "Unknown transcription failure.",
    };
  }
}

/**
 * Pre-warm the model on idle so the first real recording doesn't eat
 * the 140MB download time. Returns immediately if the browser does not
 * support the required APIs.
 */
export function preloadWhisper(onProgress?: (progress: VoiceProgress) => void): void {
  if (typeof window === "undefined") return;
  if (pipelineCache) return;
  const run = () => {
    void getPipeline(onProgress).catch(() => {
      // Silent — preload is best-effort. The next startVoice call will
      // surface the real error.
    });
  };
  if ("requestIdleCallback" in window) {
    (window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(run);
  } else {
    window.setTimeout(run, 1500);
  }
}
