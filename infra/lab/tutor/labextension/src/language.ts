import type { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application';
import { ISettingRegistry } from '@jupyterlab/settingregistry';

// The lab in the platform's language (docs/notebook-embed.md). The platform writes the language the learner picked
// to a cookie for the whole domain (adc_lang: es or en); JupyterLab's own language is a setting of its translation
// plugin, which applies at start. So when the two differ, this sets JupyterLab's and reloads, once.
//
// It also tells the platform's lesson page, which shows this lab in a frame, when JupyterLab is ready: the page shows
// its own "starting your lab" state until then.

const TRANSLATION = '@jupyterlab/translation-extension:plugin';
/** JupyterLab's locale for each platform language: the Spanish language pack, and JupyterLab's own English. */
const LOCALES = { es: 'es_ES', en: 'en' } as const;
/** One reload per language change, even if the setting can't be saved (sessionStorage is per tab). */
const RELOADED = 'academia-lab-language';
/**
 * The address the lab was opened at, read when this extension loads, before JupyterLab's router rewrites it (in the
 * single-document view it becomes the notebook's folder): the reload returns to the notebook, not the folder.
 */
const OPENED_AT = window.location.href;

/** The learner's language on the platform: the adc_lang cookie, Spanish when there's none (the platform's default). */
export function platformLanguage(): 'es' | 'en' {
  const match = /(?:^|;\s*)adc_lang=(es|en)\b/.exec(document.cookie);
  return match ? (match[1] as 'es' | 'en') : 'es';
}

function readyForThePlatform(app: JupyterFrontEnd): void {
  if (window.parent === window) return;
  void app.restored.then(() => {
    // Nothing private: just "ready", so any origin may hear it (the frame's parent is the lesson page).
    window.parent.postMessage({ source: 'academia-lab', type: 'ready' }, '*');
  });
}

export const languagePlugin: JupyterFrontEndPlugin<void> = {
  id: 'academia-tutor:language',
  description: "Keeps JupyterLab in the language the learner uses on Academia del Código.",
  autoStart: true,
  requires: [ISettingRegistry],
  activate: async (app: JupyterFrontEnd, registry: ISettingRegistry) => {
    const wanted = LOCALES[platformLanguage()];
    try {
      const settings = await registry.load(TRANSLATION);
      const current = settings.get('locale').composite as string;
      const english = wanted === 'en' && (current === 'default' || current === 'en');
      if (current !== wanted && !english) {
        let reloaded: string | null = null;
        try {
          reloaded = sessionStorage.getItem(RELOADED);
        } catch {
          // Storage can be blocked; the setting is then the only guard.
        }
        if (reloaded !== wanted) {
          try {
            sessionStorage.setItem(RELOADED, wanted);
          } catch {
            // As above.
          }
          await settings.set('locale', wanted);
          window.location.replace(OPENED_AT);
          return;
        }
      }
    } catch (error) {
      console.warn('academia-tutor: could not apply the platform language', error);
    }
    readyForThePlatform(app);
  },
};
