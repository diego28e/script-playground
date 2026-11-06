"""Academia del Código's AI tutor, server side (docs/ai-tutor.md).

Runs inside each learner's Jupyter server. The JupyterLab panel calls these endpoints on the lab's own address,
so Jupyter's login protects them; they forward to the learning service on the lab's private network with the
token JupyterHub gave this server, which the service uses to ask the hub who the learner is.

    POST /academia-tutor/turn       a tutor turn
    GET  /academia-tutor/session    ?notebookPath=  the panel's state on opening
    PUT  /academia-tutor/mode       Guide me / Show me
    POST /academia-tutor/practice   "practise this in a few days"
"""

from .handlers import setup_handlers


def _jupyter_server_extension_points():
    return [{"module": "academia_tutor"}]


def _load_jupyter_server_extension(server_app):
    setup_handlers(server_app.web_app)
    server_app.log.info("academia_tutor: forwarding to %s", server_app.web_app.settings.get("academia_tutor_url"))
