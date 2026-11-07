// The tutor panel's voice (docs/voice.md): the microphone streamed to the speech provider for a hands-free conversation,
// and replies read aloud. The provider's key never comes here: the panel asks its server for a grant (the stream's
// address and a short-lived token), opens the stream itself, and reads the provider's messages below. Only `readTurn`
// knows the provider's message format.

export type ListenGrant = {
  protocol: 'flux' | 'nova';
  url: string;
  protocols: string[];
  encoding: 'linear16';
  sampleRate: 16000;
  expiresIn: number;
};

export type StreamEvents = {
  /** The words of the turn so far, as they come. */
  onWords: (text: string) => void;
  /** The speaker finished: the whole turn. */
  onTurn: (text: string) => void;
  /** How loud the microphone is, 0..1, about ten times a second. */
  onLevel: (level: number) => void;
  /** The stream ended without being stopped: the provider closed it, or it ran for maxMinutes. */
  onEnd: (reason: 'timeout' | 'error') => void;
};

/**
 * An AudioWorklet that turns the microphone (at the device's rate, usually 48 kHz) into 16 kHz 16-bit PCM in 100 ms
 * chunks, and measures its level. Resampled here rather than by asking the AudioContext for 16 kHz, which Firefox
 * refuses for a microphone.
 */
const WORKLET = `
class Pcm16 extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / 16000;
    this.at = 0;
    this.chunk = new Int16Array(1600);
    this.filled = 0;
    this.energy = 0;
    this.count = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    let at = this.at;
    for (; at < input.length; at += this.step) {
      const index = Math.floor(at);
      const next = Math.min(index + 1, input.length - 1);
      const sample = input[index] + (input[next] - input[index]) * (at - index);
      const clamped = Math.max(-1, Math.min(1, sample));
      this.chunk[this.filled++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      this.energy += clamped * clamped;
      this.count++;
      if (this.filled === this.chunk.length) {
        this.port.postMessage({ audio: this.chunk.buffer, level: Math.sqrt(this.energy / this.count) }, [this.chunk.buffer]);
        this.chunk = new Int16Array(1600);
        this.filled = 0;
        this.energy = 0;
        this.count = 0;
      }
    }
    this.at = at - input.length;
    return true;
  }
}
registerProcessor('academia-pcm16', Pcm16);
`;

const SILENCE = new Int16Array(1600).buffer;

/** A hands-free stream: the microphone to the provider until stopped, paused while the tutor answers or speaks. */
export class VoiceStream {
  private paused = false;
  private stopped = false;
  private words = '';
  private limit: number | null = null;

  private constructor(
    private readonly socket: WebSocket,
    private readonly media: MediaStream,
    private readonly context: AudioContext,
    private readonly protocol: ListenGrant['protocol'],
    private readonly events: StreamEvents
  ) {}

  /** Asks for the microphone (the browser asks the learner once), then opens the stream. Throws on refusal. */
  static async open(grant: ListenGrant, maxMinutes: number, events: StreamEvents): Promise<VoiceStream> {
    const media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const context = new AudioContext();
    try {
      const module = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
      await context.audioWorklet.addModule(module);
      URL.revokeObjectURL(module);
      const socket = new WebSocket(grant.url, grant.protocols);
      socket.binaryType = 'arraybuffer';
      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        socket.onerror = () => reject(new Error('The voice stream could not open.'));
        setTimeout(() => reject(new Error('The voice stream took too long to open.')), 10_000);
      });
      const stream = new VoiceStream(socket, media, context, grant.protocol, events);
      stream.start(maxMinutes);
      return stream;
    } catch (error) {
      media.getTracks().forEach((track) => track.stop());
      void context.close();
      throw error;
    }
  }

  private start(maxMinutes: number): void {
    const source = this.context.createMediaStreamSource(this.media);
    const node = new AudioWorkletNode(this.context, 'academia-pcm16');
    node.port.onmessage = (event: MessageEvent<{ audio: ArrayBuffer; level: number }>) => {
      if (this.stopped || this.socket.readyState !== WebSocket.OPEN) return;
      // Paused: silence keeps the stream open without the provider hearing the room (or the tutor reading aloud).
      this.socket.send(this.paused ? SILENCE : event.data.audio);
      this.events.onLevel(this.paused ? 0 : Math.min(1, event.data.level * 4));
    };
    source.connect(node);
    this.socket.onmessage = (event) => {
      if (typeof event.data === 'string') this.readTurn(event.data);
    };
    this.socket.onclose = () => {
      if (!this.stopped) this.finish('error');
    };
    this.limit = window.setTimeout(() => this.finish('timeout'), maxMinutes * 60_000);
  }

  /** The provider's messages. Flux: TurnInfo with Update and EndOfTurn. Nova: Results, final or interim. */
  private readTurn(raw: string): void {
    let message: { type?: string; event?: string; transcript?: string; is_final?: boolean; speech_final?: boolean; channel?: { alternatives?: { transcript?: string }[] } };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (this.paused) return;
    if (this.protocol === 'flux' && message.type === 'TurnInfo') {
      const text = (message.transcript ?? '').trim();
      if (message.event === 'EndOfTurn') {
        if (text) this.events.onTurn(text);
        this.events.onWords('');
      } else if (text) {
        this.events.onWords(text);
      }
    } else if (this.protocol === 'nova' && message.type === 'Results') {
      const text = (message.channel?.alternatives?.[0]?.transcript ?? '').trim();
      if (message.is_final && text) this.words = `${this.words} ${text}`.trim();
      this.events.onWords(message.is_final ? this.words : `${this.words} ${text}`.trim());
    }
  }

  /** While the tutor answers or reads aloud: the stream stays open, sending silence. */
  pause(): void {
    this.paused = true;
    this.events.onWords('');
  }

  resume(): void {
    this.paused = false;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** The words so far (dictation). */
  get text(): string {
    return this.words;
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.cleanUp();
  }

  private finish(reason: 'timeout' | 'error'): void {
    if (this.stopped) return;
    this.stopped = true;
    this.cleanUp();
    this.events.onEnd(reason);
  }

  private cleanUp(): void {
    if (this.limit !== null) window.clearTimeout(this.limit);
    try {
      if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'CloseStream' }));
      this.socket.close();
    } catch {
      // Already closed.
    }
    this.media.getTracks().forEach((track) => track.stop());
    void this.context.close();
    this.events.onLevel(0);
  }
}

/**
 * A reply as it should sound: prose only. Code blocks become a short "(code omitted)", long inline code too, links
 * keep their text, and Markdown's marks go.
 */
export function speakable(markdown: string, codeOmitted: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ` (${codeOmitted}). `)
    .replace(/`([^`\n]{1,24})`/g, '$1')
    .replace(/`[^`\n]+`/g, codeOmitted)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/\*\*|__|~~|[*_]/g, '')
    .replace(/\|/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Text in pieces of at most `max` characters, cut at sentence ends where possible. */
export function pieces(text: string, max: number): string[] {
  // Sentences end at . ! ? or a new line; Spanish's opening ¿ and ¡ stay with their sentence.
  const sentences = text.match(/[^.!?\n]+[.!?]*\s*|\n/g) ?? [text];
  const result: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if ((current + sentence).length > max && current) {
      result.push(current.trim());
      current = '';
    }
    if (sentence.length > max) {
      for (let i = 0; i < sentence.length; i += max) result.push(sentence.slice(i, i + max));
      continue;
    }
    current += sentence;
  }
  if (current.trim()) result.push(current.trim());
  return result.filter(Boolean);
}

/** What the panel's server sends for a reply read aloud: raw 16-bit little-endian PCM, mono, at this rate. */
const SPEAK_RATE = 24_000;
/** Audio is scheduled about a fifth of a second at a time: soon enough to start at once, long enough not to stutter. */
const SCHEDULE_BYTES = (SPEAK_RATE * 2) / 5;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The browser wouldn't let the page make sound: the learner hasn't pressed anything that asked for it yet. */
export class SoundBlocked extends Error {
  constructor() {
    super('The browser blocked the sound.');
    this.name = 'SoundBlocked';
  }
}

/**
 * Reads a reply aloud as its audio streams in, through Web Audio. The text comes in pieces: all at once (play), or
 * while the tutor is still writing it (begin, push, close), each piece fetched when the one before has arrived, so
 * the reading never waits once it has started. Streamed because the provider makes audio about twice as fast as it
 * plays but takes almost a minute for a long reply whole: the first sound comes in under a second this way. One
 * reading at a time.
 *
 * Web Audio rather than an <audio> element: once a click has started its AudioContext (unlock()), sound may play at
 * any moment after, which reading a reply aloud when it arrives needs; and its analyser gives the orb the voice's level.
 */
export class Speaker {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private samples: Uint8Array<ArrayBuffer> | null = null;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private controller: AbortController | null = null;
  private active = false;
  private audible = false;
  private token = 0;
  private queue: string[] = [];
  private closed = true;
  private wake: (() => void) | null = null;

  constructor(
    private readonly fetchAudio: (text: string, signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>,
    private readonly hooks: { onStart: () => void; onEnd: () => void; onSound?: () => void }
  ) {}

  /** A reading is under way (its text may still be coming). */
  get playing(): boolean {
    return this.active;
  }

  /** Sound has started: the reading is heard, not just waiting for its first audio. */
  get sounding(): boolean {
    return this.active && this.audible;
  }

  /** Call from a click (Listen, Talk): browsers let a page make sound only once the learner asked for it. */
  unlock(): void {
    if (!this.context) {
      this.context = new AudioContext();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined);
  }

  /** How loud the reading is right now, 0..1 (for the orb). */
  get level(): number {
    if (!this.active || !this.analyser) return 0;
    if (!this.samples) this.samples = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(this.samples);
    let sum = 0;
    for (const value of this.samples) {
      const sample = (value - 128) / 128;
      sum += sample * sample;
    }
    return Math.min(1, Math.sqrt(sum / this.samples.length) * 4);
  }

  /** Reads these pieces aloud, one after another. Resolves when the reading ends or is stopped. */
  play(parts: string[]): Promise<void> {
    const done = this.begin();
    for (const part of parts) this.push(part);
    this.close();
    return done;
  }

  /** Starts a reading whose text comes later (push), ended by close(). Resolves when it has all been read, or stopped. */
  begin(): Promise<void> {
    this.stop();
    this.unlock();
    const token = ++this.token;
    this.controller = new AbortController();
    this.active = true;
    this.audible = false;
    this.queue = [];
    this.closed = false;
    this.hooks.onStart();
    return this.run(token, this.controller);
  }

  /** More text for the reading under way. */
  push(text: string): void {
    if (!this.active || this.closed || !text.trim()) return;
    this.queue.push(text);
    this.wake?.();
  }

  /** No more text: the reading ends once what it has is read. */
  close(): void {
    this.closed = true;
    this.wake?.();
  }

  private async run(token: number, controller: AbortController): Promise<void> {
    const context = this.context as AudioContext;
    const analyser = this.analyser as AnalyserNode;
    const timeline = { playhead: 0, last: null as AudioBufferSourceNode | null };
    const schedule = (bytes: Uint8Array) => {
      const count = bytes.length >> 1;
      if (!count) return;
      const buffer = context.createBuffer(1, count, SPEAK_RATE);
      const channel = buffer.getChannelData(0);
      const view = new DataView(bytes.buffer, bytes.byteOffset, count * 2);
      for (let i = 0; i < count; i++) channel[i] = view.getInt16(i * 2, true) / 0x8000;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(analyser);
      // Behind (the first audio, or the network was slow): a moment from now rather than in the past.
      const at = Math.max(timeline.playhead, context.currentTime + 0.06);
      source.start(at);
      timeline.playhead = at + buffer.duration;
      timeline.last = source;
      this.sources.add(source);
      source.onended = () => this.sources.delete(source);
      if (!this.audible) {
        this.audible = true;
        this.hooks.onSound?.();
      }
    };
    try {
      if (context.state !== 'running') await Promise.race([context.resume(), wait(500)]);
      if (context.state !== 'running') throw new SoundBlocked();
      for (;;) {
        if (token !== this.token) return;
        const part = this.queue.shift();
        if (part === undefined) {
          if (this.closed) break;
          await new Promise<void>((resolve) => (this.wake = resolve));
          this.wake = null;
          continue;
        }
        const reader = (await this.fetchAudio(part, controller.signal)).getReader();
        let pending: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (token !== this.token) return;
          if (value) {
            pending.push(value);
            size += value.length;
          }
          if (size >= SCHEDULE_BYTES || (done && size)) {
            const bytes = new Uint8Array(size);
            let at = 0;
            for (const chunk of pending) {
              bytes.set(chunk, at);
              at += chunk.length;
            }
            // An odd byte waits for its other half in the next chunk.
            const even = size & ~1;
            schedule(bytes.subarray(0, even));
            pending = even < size ? [bytes.slice(even)] : [];
            size -= even;
          }
          if (done) break;
        }
      }
      const last = timeline.last;
      if (last && context.currentTime < timeline.playhead) {
        await new Promise<void>((resolve) => last.addEventListener('ended', () => resolve(), { once: true }));
      }
    } catch (error) {
      // Stopped while it was coming in: not a failure.
      if (token !== this.token) return;
      throw error;
    } finally {
      if (token === this.token && this.active) this.end();
    }
  }

  /** Stops whatever is playing or still coming in. */
  stop(): void {
    if (!this.active) return;
    this.token++;
    this.controller?.abort();
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Not started yet, or already ended.
      }
    }
    this.sources.clear();
    this.queue = [];
    this.closed = true;
    // A reading waiting for text wakes, sees it was stopped, and ends.
    this.wake?.();
    this.end();
  }

  private end(): void {
    this.controller = null;
    this.active = false;
    this.audible = false;
    this.hooks.onEnd();
  }
}

/**
 * Where a reply still being written can be cut for reading aloud, at or after `from`: the end of the last whole
 * sentence (. ! ? followed by a space or new line, or : at a line's end; not a numbered list's "1."), or a blank
 * line, outside a code block. -1 when there is none yet.
 */
export function speechCut(markdown: string, from: number): number {
  const ends = /(?:[^\d\s][.!?…](?=\s)|:(?=\n))\s+|\n\s*\n/g;
  ends.lastIndex = from;
  let cut = -1;
  for (let match = ends.exec(markdown); match; match = ends.exec(markdown)) {
    const at = match.index + match[0].length;
    // An odd number of ``` before the cut: it's inside a code block, which is read as a whole once it closes.
    if ((markdown.slice(0, at).match(/```/g) ?? []).length % 2 === 0) cut = at;
  }
  return cut;
}
