# Runs one practice answer inside a throwaway grading container (see server.mjs): the learner's code, then the task's
# tests against it, and prints one JSON result line. The code arrives base64-encoded in environment variables and the
# result line starts with a per-run nonce, so whatever the code prints can't pass for the result.
#
# This grades practice, where cheating only cheats yourself: the code runs in the same interpreter as the tests and
# could interfere with them. Isolation from the server is the container's job (no network, read-only, gVisor).
import base64
import contextlib
import io
import json
import os
import sys
import time
import traceback

MAX_OUTPUT = 20_000
MAX_MESSAGE = 2_000


def take(name: str) -> str:
    value = os.environ.pop(name, "")
    return base64.b64decode(value).decode("utf-8") if value else ""


nonce = os.environ.pop("GRADER_NONCE", "")
code = take("GRADER_CODE")
tests = take("GRADER_TESTS")
real_stdout = sys.stdout


def short(text: str, limit: int = MAX_MESSAGE) -> str:
    return text if len(text) <= limit else text[:limit] + f"\n… ({len(text) - limit} more characters)"


def learner_traceback(error: BaseException) -> str:
    """The traceback from the learner's own code on: the harness's frames would only confuse."""
    frames = [frame for frame in traceback.extract_tb(error.__traceback__) if frame.filename in ("solution.py", "tests.py")]
    lines = traceback.format_list(frames) + traceback.format_exception_only(type(error), error)
    return short("".join(lines))


output = io.StringIO()
result: dict = {"ok": True, "error": None, "tests": [], "stdout": ""}
namespace: dict = {"__name__": "solution"}
started = time.monotonic()

with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
    try:
        exec(compile(code, "solution.py", "exec"), namespace)
    except BaseException as error:  # SystemExit and KeyboardInterrupt included: they end the answer, not the harness
        result["ok"] = False
        result["error"] = {"type": type(error).__name__, "message": learner_traceback(error)}

    if tests and result["error"] is None:
        test_namespace = dict(namespace)
        test_namespace["__name__"] = "tests"
        try:
            exec(compile(tests, "tests.py", "exec"), test_namespace)
        except BaseException as error:
            result["ok"] = False
            result["error"] = {"type": "TestSetupError", "message": learner_traceback(error)}
        else:
            for name, test in list(test_namespace.items()):
                if not (name.startswith("test_") and callable(test)):
                    continue
                entry = {"name": name, "passed": False, "message": None}
                try:
                    test()
                    entry["passed"] = True
                except AssertionError as error:
                    entry["message"] = short(str(error)) or "The check failed."
                except BaseException as error:
                    entry["message"] = learner_traceback(error)
                result["tests"].append(entry)
            result["ok"] = all(entry["passed"] for entry in result["tests"])

result["stdout"] = short(output.getvalue(), MAX_OUTPUT)
result["seconds"] = round(time.monotonic() - started, 3)
real_stdout.write("\n" + nonce + json.dumps(result) + "\n")
real_stdout.flush()
