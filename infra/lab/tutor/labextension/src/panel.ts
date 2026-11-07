import type { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import type { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { Widget } from '@lumino/widgets';
import { api, type Detour, type ModelChoice, type Mode, type Offer, type Step } from './api';
import { Orb, type OrbState } from './orb';
import { pieces, SoundBlocked, Speaker, speakable, VoiceStream } from './voice';
import { activeCellFailed, readCells } from './notebook';
import { language, t } from './strings';

type Kind = 'ask' | 'explain_error' | 'suggest_fix';

// Whether a voice conversation reads the tutor's replies aloud: the learner's choice, per browser (on at first).
const READ_ALOUD_KEY = 'academia-tutor:read-aloud';
function storedReadAloud(): boolean {
  try {
    return localStorage.getItem(READ_ALOUD_KEY) !== 'off';
  } catch {
    return true;
  }
}

// The admin's model choice, per browser: it only reorders the fallback chain, so it needs no account setting.
const MODEL_KEY = 'academia-tutor:model';
function storedModel(): string {
  try {
    return localStorage.getItem(MODEL_KEY) ?? '';
  } catch {
    return '';
  }
}
function storeModel(model: string): void {
  try {
    if (model) localStorage.setItem(MODEL_KEY, model);
    else localStorage.removeItem(MODEL_KEY);
  } catch {
    // Storage can be blocked; the choice then lasts until the page reloads.
  }
}

/**
 * The tutor's side panel: the mode switch, the objective and its micro-steps, detours in progress, the
 * conversation, the error buttons and the question box. It follows whichever notebook is current.
 */
export class TutorPanel extends Widget {
  private notebook: NotebookPanel | null = null;
  private sessionId: string | null = null;
  private mode: Mode = 'GUIDE';
  // Admins only: the models the tutor can start at, and the one chosen ('' = the chain as it is).
  private models: ModelChoice[] | null = null;
  private chosenModel = storedModel();
  private busy = false;
  // Guards against a slow answer for a notebook the learner has since left.
  private loadToken = 0;

  private readonly header = document.createElement('div');
  private readonly modeBox = document.createElement('div');
  private readonly modelBox = document.createElement('label');
  private readonly goal = document.createElement('div');
  private readonly log = document.createElement('div');
  private readonly status = document.createElement('div');
  private readonly errorBar = document.createElement('div');
  private readonly input = document.createElement('textarea');
  private readonly sendButton = document.createElement('button');
  private readonly actions = document.createElement('div');
  // Voice (docs/voice.md): a round Talk button beside Send; while the conversation is on, the box and buttons give way
  // to the dock: the orb, what it's doing, the words as they're heard, and the conversation's two switches.
  private readonly talkButton = document.createElement('button');
  private readonly dock = document.createElement('div');
  private readonly orbButton = document.createElement('button');
  private readonly orb = new Orb(() => (this.speaker.playing ? this.speaker.level : this.micLevel));
  private readonly voiceState = document.createElement('div');
  private readonly voiceWords = document.createElement('div');
  private readonly readAloudButton = document.createElement('button');
  private readonly endButton = document.createElement('button');
  private voice: VoiceStream | null = null;
  private connecting = false;
  private micLevel = 0;
  private readAloud = storedReadAloud();
  private speakingButton: HTMLButtonElement | null = null;
  private readonly speaker = new Speaker((text, signal) => api.speak(text, language, signal), {
    // The microphone mustn't hear the tutor reading aloud.
    onStart: () => {
      this.voice?.pause();
      this.renderVoice();
    },
    onEnd: () => {
      if (this.speakingButton) this.markSpeaking(this.speakingButton, false);
      this.speakingButton = null;
      if (!this.busy) this.voice?.resume();
      this.renderVoice();
    },
  });

  constructor(
    tracker: INotebookTracker,
    private readonly rendermime: IRenderMimeRegistry
  ) {
    super();
    this.addClass('jp-AcademiaTutor');
    this.id = 'academia-tutor';
    this.title.caption = t.caption;

    this.header.className = 'jp-AcademiaTutor-header';
    this.modeBox.className = 'jp-AcademiaTutor-mode';
    this.modeBox.setAttribute('role', 'radiogroup');
    this.modelBox.className = 'jp-AcademiaTutor-model';
    this.goal.className = 'jp-AcademiaTutor-goal';
    this.log.className = 'jp-AcademiaTutor-log';
    this.log.setAttribute('aria-live', 'polite');
    this.status.className = 'jp-AcademiaTutor-status';
    this.status.setAttribute('role', 'status');
    this.errorBar.className = 'jp-AcademiaTutor-errorBar';

    const form = document.createElement('form');
    form.className = 'jp-AcademiaTutor-form';
    this.input.className = 'jp-AcademiaTutor-input';
    this.input.placeholder = t.placeholder;
    this.input.rows = 3;
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    this.sendButton.type = 'submit';
    this.sendButton.className = 'jp-AcademiaTutor-send jp-mod-styled jp-mod-accept';
    this.sendButton.textContent = t.send;
    this.talkButton.type = 'button';
    this.talkButton.className = 'jp-AcademiaTutor-round jp-AcademiaTutor-talk';
    this.talkButton.setAttribute('aria-label', t.talkLabel);
    this.talkButton.append(microphoneIcon(16));
    tip(this.talkButton, t.talk, 'top');
    this.talkButton.addEventListener('click', () => void this.startVoice());
    this.actions.className = 'jp-AcademiaTutor-actions';
    this.actions.append(this.talkButton, this.sendButton);

    this.dock.className = 'jp-AcademiaTutor-dock';
    this.orbButton.type = 'button';
    this.orbButton.className = 'jp-AcademiaTutor-orbButton';
    this.orbButton.append(this.orb.node);
    // While the tutor reads aloud, the orb is the way to cut in: the reading stops and the microphone listens again.
    this.orbButton.addEventListener('click', () => {
      if (this.speaker.playing) this.speaker.stop();
    });
    this.voiceState.className = 'jp-AcademiaTutor-voiceState';
    this.voiceState.setAttribute('role', 'status');
    this.voiceWords.className = 'jp-AcademiaTutor-words';
    this.voiceWords.setAttribute('aria-live', 'polite');
    this.readAloudButton.type = 'button';
    this.readAloudButton.className = 'jp-AcademiaTutor-round';
    this.readAloudButton.addEventListener('click', () => this.toggleReadAloud());
    this.endButton.type = 'button';
    this.endButton.className = 'jp-AcademiaTutor-round jp-AcademiaTutor-end';
    this.endButton.setAttribute('aria-label', t.endTalk);
    this.endButton.append(closeIcon(16));
    tip(this.endButton, t.endTalk, 'top-center');
    this.endButton.addEventListener('click', () => this.stopVoice());
    const switches = document.createElement('div');
    switches.className = 'jp-AcademiaTutor-switches';
    switches.append(this.readAloudButton, this.endButton);
    this.dock.append(this.orbButton, this.voiceState, this.voiceWords, switches);
    form.append(this.dock, this.input, this.actions);
    this.renderVoice();
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const message = this.input.value.trim();
      if (message) void this.ask('ask', message);
    });

    this.header.append(this.modeBox, this.modelBox, this.goal);
    this.node.append(this.header, this.log, this.status, this.errorBar, form);
    this.renderMode();

    tracker.currentChanged.connect(() => void this.follow(tracker.currentWidget));
    void this.follow(tracker.currentWidget);
  }

  /** Asks the tutor, from the box or from the error buttons and commands; `spoken` when it was said out loud. */
  async ask(kind: Kind, message?: string, spoken = false): Promise<void> {
    const panel = this.notebook;
    if (!panel || this.busy) return;
    this.setBusy(true);
    this.addMessage('learner', kind === 'ask' ? (message ?? '') : kind === 'explain_error' ? t.explainAsked : t.fixAsked);
    if (kind === 'ask') this.input.value = '';
    try {
      const reply = await api.turn({
        notebookPath: panel.context.path,
        kind,
        message,
        cells: readCells(panel),
        activeCell: Math.max(0, panel.content.activeCellIndex),
        platformLanguage: language,
        ...(spoken ? { spoken: true } : {}),
        ...(this.models && this.chosenModel ? { model: this.chosenModel } : {}),
      });
      if (panel !== this.notebook) return;
      if (!reply.ok) {
        const time = reply.retryAt ? new Date(reply.retryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
        this.addNotice(reply.reason === 'quota' && time ? t.resting(time) : reply.message || t.failed);
        return;
      }
      this.sessionId = reply.sessionId;
      this.mode = reply.mode;
      this.renderMode();
      this.renderGoal(reply.objective, reply.steps, reply.unlocked, reply.detours);
      const listen = this.addMessage('tutor', reply.reply, reply.practiceOffers, reply.model, reply.chosenModel);
      // A conversation by voice is answered by voice; the microphone listens again when the reading ends.
      if (spoken && this.voice && this.readAloud && listen) void this.readReply(reply.reply, listen);
    } catch {
      this.addNotice(t.failed);
    } finally {
      this.setBusy(false);
    }
  }

  /** Re-checks whether the active cell failed, to show or hide the error buttons. */
  refreshErrorBar(): void {
    const failed = Boolean(this.notebook && activeCellFailed(this.notebook));
    this.errorBar.replaceChildren();
    if (!failed) return;
    for (const [kind, label] of [
      ['explain_error', t.explain],
      ['suggest_fix', t.fix],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'jp-mod-styled jp-AcademiaTutor-errorButton';
      button.textContent = label;
      button.disabled = this.busy;
      button.addEventListener('click', () => void this.ask(kind));
      this.errorBar.append(button);
    }
  }

  private async follow(panel: NotebookPanel | null): Promise<void> {
    if (this.notebook) {
      this.notebook.content.activeCellChanged.disconnect(this.refreshErrorBar, this);
      this.notebook.model?.contentChanged.disconnect(this.refreshErrorBar, this);
    }
    this.notebook = panel;
    this.sessionId = null;
    this.speaker.stop();
    this.stopVoice();
    this.log.replaceChildren();
    this.goal.replaceChildren();
    this.status.textContent = '';
    const token = ++this.loadToken;
    if (!panel) {
      this.addNotice(t.noNotebook);
      this.refreshErrorBar();
      return;
    }
    panel.content.activeCellChanged.connect(this.refreshErrorBar, this);
    await panel.context.ready;
    panel.model?.contentChanged.connect(this.refreshErrorBar, this);
    this.refreshErrorBar();
    try {
      const state = await api.session(panel.context.path);
      if (token !== this.loadToken) return;
      this.mode = state.mode ?? 'GUIDE';
      this.renderMode();
      this.models = state.models ?? null;
      this.renderModels();
      if (state.session) {
        this.sessionId = state.session.id;
        this.renderGoal(state.session.objective, state.session.steps, state.session.unlocked, state.session.detours);
        for (const message of state.session.messages) {
          this.addMessage(message.role === 'tutor' ? 'tutor' : 'learner', message.content, [], message.model ?? undefined);
        }
      }
      if (!this.log.childElementCount) this.addNotice(t.empty);
    } catch {
      if (token === this.loadToken) this.addNotice(t.empty);
    }
  }

  private renderMode(): void {
    this.modeBox.replaceChildren();
    for (const [mode, label, help] of [
      ['GUIDE', t.guide, t.guideHelp],
      ['SHOW', t.show, t.showHelp],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'jp-AcademiaTutor-modeButton';
      button.textContent = label;
      tip(button, help);
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(this.mode === mode));
      button.addEventListener('click', () => void this.setMode(mode));
      this.modeBox.append(button);
    }
  }

  /** The model list, for admins: "Automatic" (the chain as it is) or the model to start at. */
  private renderModels(): void {
    this.modelBox.replaceChildren();
    if (!this.models?.length) return;
    if (this.chosenModel && !this.models.some((model) => model.id === this.chosenModel)) {
      this.chosenModel = '';
      storeModel('');
    }
    const caption = document.createElement('span');
    caption.textContent = t.model;
    const select = document.createElement('select');
    select.className = 'jp-mod-styled';
    // A select can't draw a tooltip of its own (no ::after): the label around it does.
    tip(this.modelBox, t.modelHelp);
    for (const [id, label] of [['', t.modelAuto], ...this.models.map((model) => [model.id, model.label])]) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = label;
      option.selected = id === this.chosenModel;
      select.append(option);
    }
    select.addEventListener('change', () => {
      this.chosenModel = select.value;
      storeModel(this.chosenModel);
    });
    this.modelBox.append(caption, select);
  }

  private modelLabel(id: string): string {
    return this.models?.find((model) => model.id === id)?.label ?? id;
  }

  private async setMode(mode: Mode): Promise<void> {
    if (mode === this.mode) return;
    const previous = this.mode;
    this.mode = mode;
    this.renderMode();
    const result = await api.mode(mode).catch(() => ({ ok: false }));
    if (!result.ok) {
      this.mode = previous;
      this.renderMode();
      this.addNotice(t.modeFailed);
    }
  }

  private renderGoal(objective: string | null, steps: Step[], unlocked: number[], detours: Detour[]): void {
    this.goal.replaceChildren();
    if (!objective && !steps.length && !detours.length) return;
    if (objective) {
      const heading = document.createElement('div');
      heading.className = 'jp-AcademiaTutor-objective';
      heading.textContent = `${t.objective}: ${objective}`;
      this.goal.append(heading);
    }
    if (steps.length) {
      const list = document.createElement('ol');
      list.className = 'jp-AcademiaTutor-steps';
      steps.forEach((step, index) => {
        const item = document.createElement('li');
        item.dataset.status = step.status;
        item.textContent = step.text;
        if (unlocked.includes(index + 1)) {
          const badge = document.createElement('span');
          badge.className = 'jp-AcademiaTutor-unlocked';
          badge.textContent = t.unlocked;
          item.append(' ', badge);
        }
        list.append(item);
      });
      this.goal.append(list);
    }
    for (const detour of detours) {
      const row = document.createElement('div');
      row.className = 'jp-AcademiaTutor-detour';
      row.textContent = `↳ ${t.detour}: ${detour.skill} (${detour.stage === 'challenge' ? t.challenge : t.explaining})`;
      this.goal.append(row);
    }
  }

  /** Adds a message to the conversation; for the tutor's, returns its Listen button. */
  private addMessage(role: 'learner' | 'tutor', text: string, offers: Offer[] = [], model?: string, chosenModel?: string | null): HTMLButtonElement | null {
    this.log.querySelector('.jp-AcademiaTutor-notice')?.remove();
    const item = document.createElement('div');
    item.className = `jp-AcademiaTutor-message jp-AcademiaTutor-${role}`;
    const who = document.createElement('div');
    who.className = 'jp-AcademiaTutor-who';
    who.textContent = role === 'tutor' ? t.tutor : t.you;
    // Admins see which model wrote each reply, and when the one they chose didn't answer.
    if (role === 'tutor' && this.models && model) {
      const which = document.createElement('span');
      which.className = 'jp-AcademiaTutor-which';
      const fallback = chosenModel && chosenModel !== model ? ` (${t.insteadOf(this.modelLabel(chosenModel))})` : '';
      which.textContent = ` · ${this.modelLabel(model)}${fallback}`;
      who.append(which);
    }
    const listen = role === 'tutor' ? this.listenButton(text) : null;
    if (listen) who.append(listen);
    const body = document.createElement('div');
    body.className = 'jp-AcademiaTutor-body';
    item.append(who, body);
    if (role === 'tutor') {
      // JupyterLab's own Markdown renderer: sanitised, with the lab's code highlighting.
      const renderer = this.rendermime.createRenderer('text/markdown');
      void renderer.renderModel(this.rendermime.createModel({ data: { 'text/markdown': text } }));
      body.append(renderer.node);
    } else {
      body.textContent = text;
    }
    for (const offer of offers) item.append(this.offerButton(offer));
    this.log.append(item);
    this.log.scrollTop = this.log.scrollHeight;
    return listen;
  }

  private offerButton(offer: Offer): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'jp-mod-styled jp-AcademiaTutor-offer';
    button.textContent = t.practise(offer.skill);
    button.addEventListener('click', async () => {
      if (!this.sessionId) return;
      button.disabled = true;
      const result = await api.practice(this.sessionId, offer).catch(() => ({ ok: false }));
      if (result.ok) {
        button.textContent = `✓ ${t.practised(offer.skill)}`;
      } else {
        button.disabled = false;
        this.addNotice(t.practiceFailed);
      }
    });
    return button;
  }

  private addNotice(text: string): void {
    const notice = document.createElement('div');
    notice.className = 'jp-AcademiaTutor-notice';
    notice.textContent = text;
    this.log.append(notice);
    this.log.scrollTop = this.log.scrollHeight;
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.input.disabled = busy;
    this.sendButton.disabled = busy;
    this.status.textContent = busy ? t.thinking : '';
    this.node.classList.toggle('jp-mod-busy', busy);
    // The microphone waits while the tutor answers, so it never sends a second message over the first.
    if (busy) this.voice?.pause();
    else if (!this.speaker.playing) this.voice?.resume();
    this.renderVoice();
    this.refreshErrorBar();
  }

  /** Talk: the microphone on, for a hands-free conversation, each finished turn sent as a message. */
  private async startVoice(): Promise<void> {
    if (this.voice || this.connecting) return;
    // Now, inside the click: the browser then lets the replies be read aloud whenever they arrive.
    this.speaker.unlock();
    this.speaker.stop();
    this.connecting = true;
    this.renderVoice();
    try {
      const answer = await api.listen(language);
      if (!answer.ok) throw Object.assign(new Error(answer.message), { known: true });
      const stream = await VoiceStream.open(answer.grant, answer.maxMinutes, {
        onWords: (text) => {
          if (!this.busy) this.showWords(text);
        },
        onTurn: (text) => {
          if (!this.busy) void this.ask('ask', text, true);
        },
        onLevel: (level) => {
          this.micLevel = level;
        },
        onEnd: (reason) => {
          this.voice = null;
          this.renderVoice();
          this.addNotice(reason === 'timeout' ? t.talkTimeout : t.talkDropped);
        },
      });
      // Turned off while it was connecting.
      if (!this.connecting) return stream.stop();
      this.voice = stream;
      if (this.busy || this.speaker.playing) stream.pause();
    } catch (error) {
      const denied = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      const known = (error as { known?: boolean }).known ? (error as Error).message : null;
      this.addNotice(denied ? t.talkDenied : known || t.talkFailed);
    } finally {
      this.connecting = false;
      this.renderVoice();
    }
  }

  private stopVoice(): void {
    this.voice?.stop();
    this.voice = null;
    this.connecting = false;
    this.micLevel = 0;
    // Ending the conversation ends its reading too.
    this.speaker.stop();
    this.renderVoice();
  }

  private toggleReadAloud(): void {
    this.readAloud = !this.readAloud;
    try {
      localStorage.setItem(READ_ALOUD_KEY, this.readAloud ? 'on' : 'off');
    } catch {
      // Storage can be blocked; the choice then lasts until the page reloads.
    }
    if (!this.readAloud && this.speaker.playing) this.speaker.stop();
    this.renderVoice();
  }

  private showWords(text: string): void {
    this.voiceWords.textContent = text || t.voiceHint;
    this.voiceWords.classList.toggle('jp-mod-hint', !text);
  }

  private orbState(): OrbState {
    if (this.connecting) return 'connecting';
    if (this.speaker.playing) return 'speaking';
    if (this.busy) return 'thinking';
    return 'listening';
  }

  private renderVoice(): void {
    const on = Boolean(this.voice) || this.connecting;
    this.dock.hidden = !on;
    this.input.hidden = on;
    this.actions.hidden = on;
    this.node.classList.toggle('jp-mod-talking', on);
    if (!on) {
      this.orb.stop();
      return;
    }
    this.orb.start();
    const state = this.orbState();
    this.orb.set(state);
    this.orbButton.dataset.state = state;
    this.voiceState.textContent = { connecting: t.talkConnecting, listening: t.voiceListening, thinking: t.thinking, speaking: t.voiceSpeaking }[state];
    if (state === 'speaking') {
      tip(this.orbButton, t.interrupt, 'top-center');
      this.orbButton.setAttribute('aria-label', t.interrupt);
      this.orbButton.disabled = false;
    } else {
      untip(this.orbButton);
      this.orbButton.removeAttribute('aria-label');
      this.orbButton.disabled = true;
    }
    if (state !== 'listening') this.voiceWords.textContent = '';
    else if (!this.voiceWords.textContent) this.showWords('');
    this.readAloudButton.replaceChildren(this.readAloud ? speakerIcon(16) : speakerOffIcon(16));
    this.readAloudButton.setAttribute('aria-pressed', String(this.readAloud));
    this.readAloudButton.setAttribute('aria-label', t.readAloud);
    tip(this.readAloudButton, this.readAloud ? t.readAloudOn : t.readAloudOff, 'top-center');
  }

  /** "Listen" on a tutor reply: its prose read aloud; pressed again, it stops. */
  private listenButton(markdown: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'jp-AcademiaTutor-listen';
    this.markSpeaking(button, false);
    button.addEventListener('click', () => {
      if (this.speakingButton === button) return this.speaker.stop();
      // Inside the click, before anything is awaited: what lets the page make sound.
      this.speaker.unlock();
      void this.readReply(markdown, button);
    });
    return button;
  }

  /** Reads a reply aloud (code left out), marking its Listen button while it plays. */
  private async readReply(markdown: string, button: HTMLButtonElement): Promise<void> {
    // Pieces small enough that each starts at once and finishes well within the server's limits.
    const parts = pieces(speakable(markdown, t.codeOmitted), 600);
    if (!parts.length) return;
    this.speaker.stop();
    this.speakingButton = button;
    this.markSpeaking(button, true);
    try {
      await this.speaker.play(parts);
    } catch (error) {
      const known = (error as { known?: boolean }).known ? (error as Error).message : null;
      this.addNotice(error instanceof SoundBlocked ? t.listenBlocked : known || t.listenFailed);
    }
  }

  private markSpeaking(button: HTMLButtonElement, speaking: boolean): void {
    button.textContent = speaking ? t.listenStop : t.listen;
    button.prepend(speakerIcon());
    button.setAttribute('aria-pressed', String(speaking));
    button.classList.toggle('jp-mod-active', speaking);
    tip(button, t.listenHelp);
  }
}

/**
 * The panel's tooltip, drawn by style/index.css ([data-tip]): never the browser's `title`, whose look and timing are
 * the operating system's. The text is also the element's accessible description.
 */
function tip(element: HTMLElement, text: string, side: 'below' | 'top' | 'top-center' = 'below'): void {
  element.dataset.tip = text;
  // Above, for what sits at the bottom of the panel, where a tip below would be cut off.
  if (side === 'below') delete element.dataset.tipSide;
  else element.dataset.tipSide = side;
  element.setAttribute('aria-description', text);
}

function untip(element: HTMLElement): void {
  delete element.dataset.tip;
  delete element.dataset.tipSide;
  element.removeAttribute('aria-description');
}

function svgIcon(path: string, size = 14): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = path;
  return svg;
}
const microphoneIcon = (size?: number) => svgIcon('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1"/><path d="M12 18v4"/>', size);
const speakerIcon = (size?: number) => svgIcon('<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>', size);
const speakerOffIcon = (size?: number) => svgIcon('<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>', size);
const closeIcon = (size?: number) => svgIcon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', size);
