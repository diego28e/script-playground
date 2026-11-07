import { URLExt } from '@jupyterlab/coreutils';
import { ServerConnection } from '@jupyterlab/services';
import type { ListenGrant } from './voice';

// Calls to the tutor's server extension (academia_tutor, in this Jupyter server), which forwards to the learning
// service. ServerConnection adds Jupyter's own authentication, as for any JupyterLab request.

export type Mode = 'GUIDE' | 'SHOW';
export type Step = { text: string; status: 'todo' | 'stuck' | 'done' };
export type Detour = { skill: string; stage: string };
export type Offer = { skill: string; evidence: 'PASSED' | 'SKIPPED' };
export type Cell = { type: 'code' | 'markdown'; source: string; output?: string };
/** A model the tutor can start at: only admins get the list (SessionState.models). */
export type ModelChoice = { id: string; label: string };

export type TurnReply =
  | {
      ok: true;
      sessionId: string;
      reply: string;
      mode: Mode;
      objective: string | null;
      steps: Step[];
      unlocked: number[];
      detours: Detour[];
      practiceOffers: Offer[];
      model: string;
      chosenModel: string | null;
    }
  | { ok: false; reason?: string; message: string; retryAt?: string };

/** While the tutor writes: a new piece of its reply, or "start over" (another model took over the turn). */
export type ReplyEvent = { type: 'delta'; text: string } | { type: 'reset' };

export type TurnBody = {
  notebookPath: string;
  kind: 'ask' | 'explain_error' | 'suggest_fix';
  message?: string;
  cells: Cell[];
  activeCell: number;
  platformLanguage: 'es' | 'en';
  /** Said out loud in the voice conversation: the tutor answers briefly, to be heard (docs/voice.md). */
  spoken?: boolean;
  model?: string;
};

export type SessionState = {
  ok: boolean;
  mode: Mode;
  models: ModelChoice[] | null;
  session: {
    id: string;
    objective: string | null;
    steps: Step[];
    unlocked: number[];
    detours: Detour[];
    messages: { role: string; kind: string; content: string; model?: string | null }[];
  } | null;
};

const settings = ServerConnection.makeSettings();

async function call<T>(method: string, action: string, body?: unknown, query = ''): Promise<T> {
  const url = URLExt.join(settings.baseUrl, 'academia-tutor', action) + query;
  const response = await ServerConnection.makeRequest(
    url,
    { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
    settings
  );
  const data = (await response.json().catch(() => ({ ok: false, message: '' }))) as T;
  return data;
}

export const api = {
  session: (notebookPath: string) => call<SessionState>('GET', 'session', undefined, `?notebookPath=${encodeURIComponent(notebookPath)}`),
  mode: (mode: Mode) => call<{ ok: boolean }>('PUT', 'mode', { mode }),
  practice: (sessionId: string, offer: Offer) => call<{ ok: boolean }>('POST', 'practice', { sessionId, ...offer }),
  /**
   * A tutor turn, streamed: `onReply` gets the reply as the tutor writes it, and the promise the whole result once the
   * turn is saved. The service sends lines of JSON; an older one that answers in one piece works too.
   */
  turn: async (body: TurnBody, onReply: (event: ReplyEvent) => void): Promise<TurnReply> => {
    const url = URLExt.join(settings.baseUrl, 'academia-tutor', 'turn');
    const response = await ServerConnection.makeRequest(
      url,
      { method: 'POST', body: JSON.stringify({ ...body, stream: true }), headers: { 'Content-Type': 'application/json' } },
      settings
    );
    if (!(response.headers.get('Content-Type') ?? '').includes('ndjson') || !response.body) {
      return (await response.json().catch(() => ({ ok: false, message: '' }))) as TurnReply;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: TurnReply = { ok: false, message: '' };
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = done ? '' : (lines.pop() ?? '');
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as ReplyEvent | { type: 'done'; result: TurnReply };
        if (event.type === 'done') result = event.result;
        else onReply(event);
      }
      if (done) return result;
    }
  },
  /** A grant for the microphone stream (docs/voice.md). */
  listen: (language: 'es' | 'en') =>
    call<{ ok: true; grant: ListenGrant; maxMinutes: number } | { ok: false; reason?: string; message: string }>('POST', 'voice-listen', {
      mode: 'conversation',
      language,
    }),
  /**
   * A piece of a reply read aloud: raw 16-bit PCM at 24 kHz, streamed as it's made (voice.ts Speaker plays it as it
   * comes). Throws with the service's message, marked `known`, when it says why it can't.
   */
  speak: async (text: string, language: 'es' | 'en', signal: AbortSignal): Promise<ReadableStream<Uint8Array>> => {
    const url = URLExt.join(settings.baseUrl, 'academia-tutor', 'voice-speak');
    const response = await ServerConnection.makeRequest(
      url,
      { method: 'POST', body: JSON.stringify({ text, language }), headers: { 'Content-Type': 'application/json' }, signal },
      settings
    );
    if (!response.ok || !response.body || !(response.headers.get('Content-Type') ?? '').startsWith('audio/')) {
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      throw Object.assign(new Error(body.message || 'The reply could not be read aloud.'), { known: Boolean(body.message) });
    }
    return response.body;
  },
};
