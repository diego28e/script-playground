import type { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import type { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { Widget } from '@lumino/widgets';
import { api, type Detour, type ModelChoice, type Mode, type Offer, type Step } from './api';
import { activeCellFailed, readCells } from './notebook';
import { language, t } from './strings';

type Kind = 'ask' | 'explain_error' | 'suggest_fix';

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
    form.append(this.input, this.sendButton);
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

  /** Asks the tutor, from the box or from the error buttons and commands. */
  async ask(kind: Kind, message?: string): Promise<void> {
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
      this.addMessage('tutor', reply.reply, reply.practiceOffers, reply.model, reply.chosenModel);
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
      button.title = help;
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
    select.title = t.modelHelp;
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

  private addMessage(role: 'learner' | 'tutor', text: string, offers: Offer[] = [], model?: string, chosenModel?: string | null): void {
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
    this.refreshErrorBar();
  }
}
