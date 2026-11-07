import json
import os
import re
from pathlib import Path

import tornado
from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
from tornado.httpclient import AsyncHTTPClient, HTTPClientError, HTTPRequest

# The learning service on the lab's Docker network (infra/lab/compose.yaml).
LEARNING_URL = os.environ.get("ACADEMIA_LEARNING_URL", "http://learning:8080").rstrip("/")
# A tutor turn can take a while when the first models are busy and it falls back.
TURN_TIMEOUT = 75
# A piece of a reply read aloud streams for as long as it plays (docs/voice.md).
SPEAK_TIMEOUT = 180

# Where course notebooks start in a path: the platform stores lessons by their path inside the course repository.
COURSE_SEGMENT = re.compile(r"(?:^|/)((?:modules|capstones)/.+\.ipynb)$")
SOLUTION_LIMIT = 150_000


def course_path(path: str) -> str:
    """'langchain-langgraph-mastery/modules/00-foundations/x.ipynb' -> 'modules/00-foundations/x.ipynb'."""
    match = COURSE_SEGMENT.search(path.replace("\\", "/"))
    return match.group(1) if match else path


def solution_text(root_dir: str, path: str) -> str | None:
    """The reference solution beside a notebook, when the course has one: <dir>/solutions/<stem>-solution.ipynb."""
    notebook = (Path(root_dir) / path).resolve()
    candidate = notebook.parent / "solutions" / f"{notebook.stem}-solution.ipynb"
    try:
        # Stay inside the learner's work folder.
        candidate.relative_to(Path(root_dir).resolve())
        cells = json.loads(candidate.read_text(encoding="utf-8")).get("cells", [])
    except (ValueError, OSError, json.JSONDecodeError):
        return None
    text = "\n\n".join(
        f"# [{cell.get('cell_type')}]\n" + ("".join(cell["source"]) if isinstance(cell.get("source"), list) else cell.get("source", ""))
        for cell in cells
    )
    return text[:SOLUTION_LIMIT] or None


class TutorHandler(APIHandler):
    async def forward(self, method: str, action: str, body: dict | None = None, query: str = ""):
        token = os.environ.get("JUPYTERHUB_API_TOKEN")
        if not token:
            self.set_status(503)
            return self.finish(json.dumps({"ok": False, "message": "The tutor works in the lab only."}))
        request = HTTPRequest(
            f"{LEARNING_URL}/v1/{action}{query}",
            method=method,
            headers={"Authorization": f"token {token}", "Content-Type": "application/json"},
            body=json.dumps(body) if body is not None else None,
            request_timeout=TURN_TIMEOUT,
        )
        try:
            response = await AsyncHTTPClient().fetch(request, raise_error=False)
        except (HTTPClientError, OSError) as error:
            self.log.warning("academia_tutor: learning service unreachable: %s", error)
            self.set_status(503)
            return self.finish(json.dumps({"ok": False, "message": "The tutor isn't reachable right now. Try again in a minute."}))
        self.set_status(response.code if response.code != 599 else 503)
        # JSON for most answers; a reply read aloud comes back as MP3 (voice/speak). APIHandler.finish sets the type,
        # JSON unless told otherwise.
        self.finish(response.body or b"{}", set_content_type=response.headers.get("Content-Type", "application/json"))

    async def stream(self, action: str, body: dict):
        """Passes the learning service's answer on as it arrives: a reply read aloud plays while it's being made."""
        token = os.environ.get("JUPYTERHUB_API_TOKEN")
        if not token:
            self.set_status(503)
            return self.finish(json.dumps({"ok": False, "message": "The tutor works in the lab only."}))
        upstream = {"code": 200, "type": "application/json", "started": False}

        def on_header(line: str):
            if line.startswith("HTTP/"):
                upstream["code"] = int(line.split(" ", 2)[1])
            elif line.lower().startswith("content-type:"):
                upstream["type"] = line.split(":", 1)[1].strip()

        def on_chunk(chunk: bytes):
            if self.request.connection.stream is None or self.request.connection.stream.closed():
                raise OSError("The listener left.")
            if not upstream["started"]:
                upstream["started"] = True
                self.set_status(upstream["code"])
                self.set_header("Content-Type", upstream["type"])
                self.set_header("Cache-Control", "no-store")
                self.set_header("X-Accel-Buffering", "no")
            self.write(chunk)
            self.flush()

        request = HTTPRequest(
            f"{LEARNING_URL}/v1/{action}",
            method="POST",
            headers={"Authorization": f"token {token}", "Content-Type": "application/json"},
            body=json.dumps(body),
            request_timeout=SPEAK_TIMEOUT,
            header_callback=on_header,
            streaming_callback=on_chunk,
        )
        try:
            await AsyncHTTPClient().fetch(request, raise_error=False)
        except (HTTPClientError, OSError) as error:
            if upstream["started"]:
                return
            self.log.warning("academia_tutor: learning service unreachable: %s", error)
            self.set_status(503)
            return self.finish(json.dumps({"ok": False, "message": "The tutor isn't reachable right now. Try again in a minute."}))
        if not upstream["started"]:
            self.set_status(upstream["code"] if upstream["code"] != 599 else 503)
            return self.finish(b"{}")
        try:
            self.finish(set_content_type=upstream["type"])
        except Exception:  # noqa: BLE001 - the listener stopped and left: nothing more to send.
            pass

    @tornado.web.authenticated
    async def post(self, action: str):
        body = self.get_json_body() or {}
        if action == "turn":
            path = str(body.get("notebookPath", ""))
            root_dir = self.settings.get("server_root_dir", os.getcwd())
            solution = solution_text(root_dir, path)
            if solution:
                body["solution"] = solution
            body["notebookPath"] = course_path(path)
            return await self.forward("POST", "turn", body)
        if action == "practice":
            return await self.forward("POST", "practice", body)
        # Voice (docs/voice.md): a grant for the microphone stream, and a reply read aloud.
        if action == "voice-listen":
            return await self.forward("POST", "voice/listen", body)
        if action == "voice-speak":
            return await self.stream("voice/speak", body)
        self.set_status(404)
        self.finish(json.dumps({"ok": False}))

    @tornado.web.authenticated
    async def get(self, action: str):
        if action != "session":
            self.set_status(404)
            return self.finish(json.dumps({"ok": False}))
        path = course_path(self.get_argument("notebookPath", ""))
        return await self.forward("GET", "session", query=f"?notebookPath={tornado.escape.url_escape(path, plus=False)}")

    @tornado.web.authenticated
    async def put(self, action: str):
        if action != "mode":
            self.set_status(404)
            return self.finish(json.dumps({"ok": False}))
        return await self.forward("PUT", "mode", self.get_json_body() or {})


def setup_handlers(web_app):
    web_app.settings["academia_tutor_url"] = LEARNING_URL
    pattern = url_path_join(web_app.settings["base_url"], "academia-tutor", "(turn|session|mode|practice|voice-listen|voice-speak)")
    web_app.add_handlers(".*$", [(pattern, TutorHandler)])
