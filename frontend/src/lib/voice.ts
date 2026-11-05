// Hands-free voice for Elvis. The microphone streams to /api/v1/assistant/voice, which relays it to Meta's Muse
// Voice Transcribe and sends back each finished turn. Answers are read aloud with the browser's own speech
// synthesis. Audio goes out as 16-bit mono PCM at 24 kHz in 80 ms frames, in real time; while Elvis is thinking
// or speaking we send silence instead, so it doesn't hear itself and the transcriber never falls behind.

export type VoiceServerEvent =
  | { type: "ready" }
  | { type: "partial"; text: string }
  | { type: "utterance"; text: string }
  | { type: "ended"; reason: "idle" | "time_limit" | "stopped" | "transcriber_closed" }
  | { type: "error"; code: string; message: string };

export interface VoiceLink {
  /** Send silence instead of the microphone. */
  setMuted(muted: boolean): void;
  /** A short two-note cue that Elvis is listening. */
  chime(): void;
  stop(): void;
}

const FRAME_SAMPLES = 1920; // 80 ms at 24 kHz

// Resamples the microphone to 24 kHz (linear interpolation is plenty for speech) and posts 80 ms frames.
const WORKLET = `
class Pcm24k extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / 24000;
    this.t = 0;
    this.last = 0;
    this.frame = new Int16Array(${FRAME_SAMPLES});
    this.n = 0;
    this.energy = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input || input.length === 0) return true;
    const len = input.length;
    while (this.t < len - 1) {
      const i = Math.floor(this.t);
      const a = i < 0 ? this.last : input[i];
      const s = Math.max(-1, Math.min(1, a + (input[i + 1] - a) * (this.t - i)));
      this.frame[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      this.energy += s * s;
      if (this.n === ${FRAME_SAMPLES}) {
        const level = Math.min(1, Math.sqrt(this.energy / ${FRAME_SAMPLES}) * 5);
        this.port.postMessage({ pcm: this.frame.buffer, level }, [this.frame.buffer]);
        this.frame = new Int16Array(${FRAME_SAMPLES});
        this.n = 0;
        this.energy = 0;
      }
      this.t += this.step;
    }
    this.t -= len;
    this.last = input[len - 1];
    return true;
  }
}
registerProcessor("pcm24k", Pcm24k);
`;

export function voiceSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof AudioWorkletNode !== "undefined" &&
    "speechSynthesis" in window
  );
}

function socketUrl(): string {
  // In development the page (port 3000) and the API (port 8000) differ, and Next's dev proxy doesn't carry
  // WebSockets; cookies ignore ports, so the session still applies. In production the Worker forwards it.
  const base =
    process.env.NODE_ENV === "development"
      ? process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"
      : window.location.origin;
  return `${base.replace(/\/$/, "").replace(/^http/, "ws")}/api/v1/assistant/voice`;
}

/** Ask for the microphone and open the voice link. Throws if the microphone is refused. */
export async function startVoice(handlers: {
  onEvent: (event: VoiceServerEvent) => void;
  onLevel: (level: number) => void;
  onClose: () => void;
}): Promise<VoiceLink> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const ctx = new AudioContext();
  let ws: WebSocket | null = null;
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000);
    handlers.onClose();
  };

  try {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
  } catch (err) {
    cleanup();
    throw err;
  }
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm24k");
  const sink = ctx.createGain();
  sink.gain.value = 0; // the graph has to reach the output to run; nothing is heard
  source.connect(node).connect(sink).connect(ctx.destination);

  const socket = new WebSocket(socketUrl());
  ws = socket;
  socket.binaryType = "arraybuffer";
  const silence = new ArrayBuffer(FRAME_SAMPLES * 2);
  let muted = false;
  // Nothing is sent until the transcriber is ready: audio queued before then would reach it faster than real
  // time, which it rejects. The chime on `ready` tells the reviewer to start talking.
  let ready = false;
  node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
    handlers.onLevel(muted || !ready ? 0 : e.data.level);
    if (ready && socket.readyState === WebSocket.OPEN) socket.send(muted ? silence : e.data.pcm);
  };
  socket.onmessage = (e) => {
    if (typeof e.data !== "string") return;
    let event: VoiceServerEvent;
    try {
      event = JSON.parse(e.data) as VoiceServerEvent;
    } catch {
      return;
    }
    if (event.type === "ready") ready = true;
    handlers.onEvent(event);
  };
  socket.onclose = cleanup;

  return {
    setMuted(next) {
      muted = next;
    },
    chime() {
      if (closed) return;
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      [660, 880].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const start = ctx.currentTime + i * 0.12;
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.08, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);
        osc.start(start);
        osc.stop(start + 0.12);
      });
    },
    stop() {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "stop" }));
      cleanup();
    },
  };
}

// ----------------------------------------------------------------------------- speaking

/** Answer text as it should sound: no markdown, and references spelled out letter by letter. */
export function spokenText(text: string): string {
  return text
    .replace(/\b(INC|MS)-([2-9A-HJKMNP-Z]{6})\b/g, (_, prefix: string, code: string) => `${prefix.split("").join(" ")}, ${code.split("").join(" ")}`)
    .replace(/\*\*|`|#+\s/g, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/([^.!?:;,])\s*\n+/g, "$1. ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickVoice(): SpeechSynthesisVoice | null {
  const english = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
  const score = (v: SpeechSynthesisVoice) =>
    (v.lang === "en-GB" ? 3 : v.lang === "en-US" ? 2 : 1) +
    (/natural|neural|premium|enhanced|google/i.test(v.name) ? 2 : 0) +
    (v.localService ? 0.5 : 0);
  return english.sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** Read text aloud, a sentence at a time (long utterances stall in some browsers). Returns a cancel function. */
export function speak(text: string, onDone: () => void): () => void {
  const synth = window.speechSynthesis;
  const sentences = spokenText(text).match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  const voice = pickVoice();
  let cancelled = false;
  let index = 0;
  synth.cancel();

  const next = () => {
    if (cancelled) return;
    if (index >= sentences.length) {
      onDone();
      return;
    }
    const sentence = sentences[index++];
    const utterance = new SpeechSynthesisUtterance(sentence);
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? "en-GB";
    utterance.rate = 1.05;
    let moved = false;
    const advance = () => {
      if (moved) return;
      moved = true;
      clearTimeout(watchdog);
      next();
    };
    // Some browsers occasionally never fire `end`; don't let that leave Elvis stuck "speaking".
    const watchdog = setTimeout(advance, 2500 + sentence.length * 90);
    utterance.onend = advance;
    utterance.onerror = advance;
    synth.speak(utterance);
  };
  next();
  return () => {
    cancelled = true;
    synth.cancel();
  };
}

// ----------------------------------------------------------------------------- spoken commands

const words = (text: string) => text.toLowerCase().replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim();

const CONFIRM = /^(yes|yeah|yep|yup|sure|confirm|confirmed|confirm it|confirm that|do it|go ahead|yes please|yes confirm|yes confirm it|yes do it|ok do it|okay do it|ok confirm|okay confirm|approve|approve it)$/;
const CANCEL = /^(no|nope|cancel|cancel it|cancel that|dismiss|dismiss it|don't|do not|never mind|no thanks|no thank you|skip|skip it|leave it)$/;
const END = /^(stop listening|stop voice|turn off voice|voice off|end voice|goodbye|bye|bye elvis|goodbye elvis|that's all|thats all|that's all thanks|that's all thank you)$/;

/** A reply to a pending suggestion, or a request to end voice. Anything else is a question for Elvis. */
export function spokenCommand(text: string): "confirm" | "cancel" | "end" | null {
  const said = words(text);
  if (CONFIRM.test(said)) return "confirm";
  if (CANCEL.test(said)) return "cancel";
  if (END.test(said)) return "end";
  return null;
}
