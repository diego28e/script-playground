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

/** Plays a reply aloud, piece after piece, fetching the next while the current one plays. One at a time. */
export class Speaker {
  private audio: HTMLAudioElement | null = null;
  private active = false;
  private token = 0;

  constructor(
    private readonly fetchAudio: (text: string) => Promise<Blob>,
    private readonly hooks: { onStart: () => void; onEnd: () => void }
  ) {}

  get playing(): boolean {
    return this.active;
  }

  async play(parts: string[]): Promise<void> {
    this.stop();
    const token = ++this.token;
    this.active = true;
    this.hooks.onStart();
    try {
      let next = parts.length ? this.fetchAudio(parts[0]) : null;
      for (let i = 0; i < parts.length && next; i++) {
        const blob = await next;
        if (token !== this.token) return;
        next = i + 1 < parts.length ? this.fetchAudio(parts[i + 1]) : null;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        this.audio = audio;
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error('The audio could not play.'));
          audio.play().catch(reject);
        }).finally(() => URL.revokeObjectURL(url));
        if (token !== this.token) return;
      }
    } finally {
      // Ended on its own (or failed): stop() handles the case where it was stopped.
      if (token === this.token && this.active) this.end();
    }
  }

  /** Stops whatever is playing or being fetched. */
  stop(): void {
    if (!this.active) return;
    this.token++;
    this.audio?.pause();
    this.end();
  }

  private end(): void {
    this.audio = null;
    this.active = false;
    this.hooks.onEnd();
  }
}
