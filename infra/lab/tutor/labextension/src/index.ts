import type { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application';
import { ICommandPalette } from '@jupyterlab/apputils';
import { INotebookTracker } from '@jupyterlab/notebook';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { LabIcon } from '@jupyterlab/ui-components';
import { languagePlugin } from './language';
import { TutorPanel } from './panel';
import { t } from './strings';

// Academia del Código's AI tutor in JupyterLab (docs/ai-tutor.md): a panel in the right sidebar, and two commands
// on a cell's context menu. The server side is academia_tutor (this package's Python half).

const capIcon = new LabIcon({
  name: 'academia-tutor:cap',
  svgstr:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16"><path class="jp-icon3" fill="#616161" d="M12 3 1 9l11 6 9-4.91V17h2V9L12 3zm-6.82 9.18v4L12 20l6.82-3.82v-4L12 16l-6.82-3.82z"/></svg>',
});

const COMMANDS = {
  explain: 'academia-tutor:explain-error',
  fix: 'academia-tutor:suggest-fix',
  open: 'academia-tutor:open',
};

const plugin: JupyterFrontEndPlugin<void> = {
  id: 'academia-tutor:plugin',
  description: "Academia del Código's AI tutor.",
  autoStart: true,
  requires: [INotebookTracker, IRenderMimeRegistry],
  optional: [ICommandPalette],
  activate: (app: JupyterFrontEnd, tracker: INotebookTracker, rendermime: IRenderMimeRegistry, palette: ICommandPalette | null) => {
    const panel = new TutorPanel(tracker, rendermime);
    panel.title.icon = capIcon;
    app.shell.add(panel, 'right', { rank: 600 });

    const reveal = () => app.shell.activateById(panel.id);
    app.commands.addCommand(COMMANDS.open, { label: t.caption, execute: reveal });
    app.commands.addCommand(COMMANDS.explain, {
      label: t.explain,
      isEnabled: () => tracker.currentWidget !== null,
      execute: () => {
        reveal();
        return panel.ask('explain_error');
      },
    });
    app.commands.addCommand(COMMANDS.fix, {
      label: t.fix,
      isEnabled: () => tracker.currentWidget !== null,
      execute: () => {
        reveal();
        return panel.ask('suggest_fix');
      },
    });

    app.contextMenu.addItem({ command: COMMANDS.explain, selector: '.jp-Notebook .jp-Cell', rank: 0 });
    app.contextMenu.addItem({ command: COMMANDS.fix, selector: '.jp-Notebook .jp-Cell', rank: 0 });
    if (palette) {
      for (const command of Object.values(COMMANDS)) palette.addItem({ command, category: 'Academia' });
    }
  },
};

// The tutor, and the lab kept in the platform's language (language.ts).
export default [plugin, languagePlugin];
