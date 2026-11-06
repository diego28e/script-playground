import type { NotebookPanel } from '@jupyterlab/notebook';
import type { Cell } from './api';

// The notebook as the tutor reads it: each cell's source and its outputs as plain text. Images and widgets are
// left out; an error keeps its name, message and traceback (without terminal colour codes).

const ANSI = /\u001b\[[0-9;]*m/g;

type Output = {
  output_type: string;
  text?: string | string[];
  data?: Record<string, unknown>;
  ename?: string;
  evalue?: string;
  traceback?: string[];
};

const join = (value: unknown) => (Array.isArray(value) ? value.join('') : typeof value === 'string' ? value : '');

function outputText(output: Output): string {
  switch (output.output_type) {
    case 'stream':
      return join(output.text);
    case 'error':
      return `${output.ename}: ${output.evalue}\n${(output.traceback ?? []).join('\n')}`.replace(ANSI, '');
    case 'execute_result':
    case 'display_data':
      return join(output.data?.['text/plain']);
    default:
      return '';
  }
}

function outputsOf(panel: NotebookPanel, index: number): Output[] {
  const model = panel.content.widgets[index]?.model;
  if (!model || model.type !== 'code') return [];
  const outputs = (model as unknown as { outputs: { length: number; get(i: number): { toJSON(): Output } } }).outputs;
  const list: Output[] = [];
  for (let i = 0; i < outputs.length; i++) list.push(outputs.get(i).toJSON());
  return list;
}

export function readCells(panel: NotebookPanel): Cell[] {
  return panel.content.widgets.map((widget, index) => {
    const type = widget.model.type === 'code' ? 'code' : 'markdown';
    const output = outputsOf(panel, index).map(outputText).filter(Boolean).join('\n');
    return { type, source: widget.model.sharedModel.getSource(), ...(output ? { output } : {}) };
  });
}

/** Whether the active cell shows an error or a failed acceptance check (❌), which brings up the error buttons. */
export function activeCellFailed(panel: NotebookPanel): boolean {
  const index = panel.content.activeCellIndex;
  return outputsOf(panel, index).some((output) => output.output_type === 'error' || outputText(output).includes('❌'));
}
