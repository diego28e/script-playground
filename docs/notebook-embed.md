# Notebook in the lesson page (milestone 11)

A lesson's notebook, open and runnable inside the lesson page, in the learner's own lab, in the language they use on
the platform.

## Decisions (interview, 2026-11-06)

| Question | Decision |
|---|---|
| What the embedded view shows | Just the lesson's notebook: JupyterLab's single-document view (`/doc/tree/<path>`), with its toolbar and the tutor panel; no file browser or other tabs. "Open the full lab" opens the usual lab in a new tab. |
| Where it sits | Tabs at the top of the lesson: **Lesson** (video and text) and **Notebook** (full width). The chosen tab is kept in the address (`?tab=notebook`), and the video keeps its place when the learner switches back. |
| When the lab starts | Only when the learner opens the Notebook tab. Until the server answers, the tab shows the platform's own "starting your lab" state, not the hub's page. |
| Language | JupyterLab and the hub's pages follow the platform's language (Spanish or English): the one the learner picked, or the platform's own default, and switch when the learner switches it there. |

Phones: JupyterLab isn't usable at phone width, so below 768 px the Notebook tab says so and offers "Open in your
lab" (a new tab), as the lesson page does today.

## How it works

- **Framing.** JupyterHub and its single-user servers send `Content-Security-Policy: frame-ancestors 'none'` by
  default (since JupyterHub 4.1), so nothing may frame them. Both now send `frame-ancestors 'self'` plus the platform
  (`LAB_PLATFORM_URL`, and `LAB_EXTRA_FRAME_ANCESTORS` if ever needed): the hub through `tornado_settings` in
  `jupyterhub_config.py`, each learner's server through `jupyter_server_config.py`, which reads the list the hub puts
  in its environment (`LAB_FRAME_ANCESTORS`). Both keep a value set in their config. Nothing else may frame the lab.
- **Sign-in.** The lab and the platform are one site (`academiadelcodigo.com`), so the lab's cookies are sent inside
  the frame. The lab signs in through the platform (OAuth); a learner signed in on the platform passes through it
  without seeing anything. The lesson page only shows the Notebook tab to signed-in, enrolled learners.
- **The address.** `/hub/user-redirect/doc/tree/<course slug>/<lesson path>`: the hub starts the server if it's
  stopped and opens the notebook in single-document mode.
- **Language.** The platform writes its language to a cookie for the whole domain (`adc_lang`, on
  `.academiadelcodigo.com`), next to the `localStorage` value it already keeps. In the lab, a small JupyterLab plugin
  (in the tutor's extension) reads it and sets JupyterLab's language (`@jupyterlab/translation-extension`), reloading
  once when it changes; the hub's pages show the matching language. The image gets JupyterLab's Spanish language pack
  (`jupyterlab-language-pack-es-ES`).
- **Starting.** The frame loads only when the Notebook tab opens. Until JupyterLab has loaded (the frame's load event,
  then a ready message from the plugin), the tab shows a starting state over it, with a "taking longer than usual"
  note and "Open in a new tab" after 60 s.

## Build order

1. **The lab:** framing allowed from the platform; the Spanish language pack; the language plugin; the hub's pages in
   both languages. A new image and a hub restart, on the server (step by step).
2. **The platform:** the language cookie; the Lesson / Notebook tabs; the frame, its starting state and "Open the full
   lab"; the phone fallback.
3. Tried in production with a learner account, desktop and phone; docs and tracker.
