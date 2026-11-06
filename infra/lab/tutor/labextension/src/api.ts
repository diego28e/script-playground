import { URLExt } from '@jupyterlab/coreutils';
import { ServerConnection } from '@jupyterlab/services';

// Calls to the tutor's server extension (academia_tutor, in this Jupyter server), which forwards to the learning
// service. ServerConnection adds Jupyter's own authentication, as for any JupyterLab request.

export type Mode = 'GUIDE' | 'SHOW';
export type Step = { text: string; status: 'todo' | 'stuck' | 'done' };
export type Detour = { skill: string; stage: string };
export type Offer = { skill: string; evidence: 'PASSED' | 'SKIPPED' };
export type Cell = { type: 'code' | 'markdown'; source: string; output?: string };

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
    }
  | { ok: false; reason?: string; message: string; retryAt?: string };

export type SessionState = {
  ok: boolean;
  mode: Mode;
  session: {
    id: string;
    objective: string | null;
    steps: Step[];
    unlocked: number[];
    detours: Detour[];
    messages: { role: string; kind: string; content: string }[];
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
  turn: (body: {
    notebookPath: string;
    kind: 'ask' | 'explain_error' | 'suggest_fix';
    message?: string;
    cells: Cell[];
    activeCell: number;
    platformLanguage: 'es' | 'en';
  }) => call<TurnReply>('POST', 'turn', body),
};
