// The grader: runs a practice answer (and its tests) in a throwaway container and returns the result
// (docs/practice.md). The platform calls it over HTTPS through nginx at /grader/ on the lab's domain, signing each
// request with a shared secret. No dependencies: Docker's Engine API is plain HTTP over its socket.
//
// Each run gets a fresh container from the lab's student image (the course's own Python and packages), or for a
// TypeScript answer from the TypeScript sandbox image (ts-sandbox/: Node 26 and tsc 7, docs/practice.md "Languages"), with no network,
// a read-only filesystem but a small /tmp, every capability dropped, no privilege gain, 256 MB, one CPU, 64
// processes, and the gVisor runtime (a sandbox kernel) on the server. This service holds the Docker socket, which makes
// it root-equivalent on the host: it never runs learner code itself, only creates, waits for and removes containers.
//
//   POST /v1/run   {code, tests?, timeoutMs?, language?}  ->  {status, ok, tests, error, stdout, seconds, wallMs, language}
// language is "python" (the default) or "typescript"; a TypeScript result also has `diagnostics`, what tsc reported.
//   GET  /healthz
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, request } from "node:http";

const PORT = Number(process.env.PORT ?? 8080);
const SECRET = process.env.GRADER_SECRET ?? "";
const IMAGE = process.env.GRADER_IMAGE ?? "";
// "runsc" (gVisor) on the server; "runc" where gVisor isn't installed (Docker Desktop on a PC).
const RUNTIME = process.env.GRADER_RUNTIME ?? "runsc";
const PYTHON = process.env.GRADER_PYTHON ?? "/opt/course/bin/python";
const SOCKET = process.env.DOCKER_SOCKET ?? "/var/run/docker.sock";
const HARNESS = readFileSync(new URL("./harness.py", import.meta.url), "utf8");
// TypeScript answers (optional: without an image the grader runs Python only and says so).
const TS_IMAGE = process.env.GRADER_TS_IMAGE ?? "";
const HARNESS_TS = readFileSync(new URL("./harness-ts.mjs", import.meta.url), "utf8");

const MAX_CODE = 64 * 1024;
const MAX_BODY = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 30_000;
// Runs at once, and runs waiting: the server has 4 cores and other work to do.
const MAX_RUNNING = 3;
const MAX_WAITING = 30;
const CLOCK_SKEW_MS = 5 * 60_000;
const LABEL = "academia.grader";

const log = (entry) => console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));

if (!SECRET || SECRET.length < 32) throw new Error("GRADER_SECRET must be set (32 characters or more).");
if (!IMAGE) throw new Error("GRADER_IMAGE must be set to the student image.");

// --- Docker Engine API over the socket ---------------------------------------------------------------------------

function docker(method, path, body, { raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      { socketPath: SOCKET, path, method, headers: payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {} },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          if (raw) return resolve({ status: res.statusCode ?? 0, buffer });
          const text = buffer.toString("utf8");
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = { message: text };
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Container logs without a TTY come as frames: 8-byte header (stream, 0, 0, 0, size big-endian), then the bytes. */
function demultiplex(buffer) {
  let out = "";
  for (let offset = 0; offset + 8 <= buffer.length; ) {
    const size = buffer.readUInt32BE(offset + 4);
    out += buffer.subarray(offset + 8, offset + 8 + size).toString("utf8");
    offset += 8 + size;
  }
  return out;
}

async function removeContainer(id) {
  await docker("DELETE", `/containers/${id}?force=1&v=1`).catch(() => undefined);
}

/** Leftovers from a crash or restart: grading containers are never kept. */
async function cleanUp() {
  const filters = encodeURIComponent(JSON.stringify({ label: [LABEL] }));
  const { json } = await docker("GET", `/containers/json?all=1&filters=${filters}`).catch(() => ({ json: [] }));
  for (const container of Array.isArray(json) ? json : []) await removeContainer(container.Id);
}

// --- One run -------------------------------------------------------------------------------------------------------

/** What a run of each language starts: the image, its harness, and what its environment needs. */
const LANGUAGES = {
  python: { image: () => IMAGE, entrypoint: [PYTHON, "-I", "-c", HARNESS], env: ["PYTHONDONTWRITEBYTECODE=1", "MPLCONFIGDIR=/tmp"] },
  // Node runs the harness as a module; the harness runs tsc, then imports the answer (Node strips its types).
  typescript: { image: () => TS_IMAGE, entrypoint: ["node", "--input-type=module", "-e", HARNESS_TS], env: ["NODE_DISABLE_COLORS=1", "NO_COLOR=1"] },
};

async function run({ code, tests, timeoutMs, language }) {
  const nonce = randomBytes(16).toString("hex");
  const started = Date.now();
  const kind = LANGUAGES[language];
  const created = await docker("POST", `/containers/create?name=grader-${nonce.slice(0, 12)}`, {
    Image: kind.image(),
    Entrypoint: kind.entrypoint,
    Cmd: [],
    User: "1000:1000",
    WorkingDir: "/tmp",
    Env: [
      `GRADER_NONCE=${nonce}`,
      `GRADER_CODE=${Buffer.from(code, "utf8").toString("base64")}`,
      `GRADER_TESTS=${Buffer.from(tests ?? "", "utf8").toString("base64")}`,
      "HOME=/tmp",
      ...kind.env,
    ],
    NetworkDisabled: true,
    Labels: { [LABEL]: "1" },
    HostConfig: {
      Runtime: RUNTIME,
      NetworkMode: "none",
      Memory: 256 * 1024 * 1024,
      MemorySwap: 256 * 1024 * 1024,
      NanoCpus: 1_000_000_000,
      PidsLimit: 64,
      ReadonlyRootfs: true,
      Tmpfs: { "/tmp": "rw,nosuid,nodev,size=16m" },
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      Ulimits: [
        { Name: "nofile", Soft: 256, Hard: 256 },
        { Name: "fsize", Soft: 16 * 1024 * 1024, Hard: 16 * 1024 * 1024 },
      ],
      LogConfig: { Type: "json-file", Config: { "max-size": "1m" } },
    },
  });
  if (created.status !== 201) throw new Error(`create failed (${created.status}): ${created.json?.message ?? ""}`);
  const id = created.json.Id;
  try {
    const startedResponse = await docker("POST", `/containers/${id}/start`);
    if (startedResponse.status !== 204) throw new Error(`start failed (${startedResponse.status}): ${startedResponse.json?.message ?? ""}`);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void docker("POST", `/containers/${id}/kill`).catch(() => undefined);
    }, timeoutMs);
    await docker("POST", `/containers/${id}/wait?condition=not-running`);
    clearTimeout(timer);

    const [{ json: inspect }, { buffer }] = await Promise.all([
      docker("GET", `/containers/${id}/json`),
      docker("GET", `/containers/${id}/logs?stdout=1&stderr=1&tail=200`, undefined, { raw: true }),
    ]);
    const wallMs = Date.now() - started;
    const output = demultiplex(buffer);
    const line = output.split("\n").reverse().find((entry) => entry.startsWith(nonce));
    if (timedOut) return { status: "timeout", ok: false, tests: [], error: { type: "Timeout", message: `The answer ran for more than ${Math.round(timeoutMs / 1000)} seconds.` }, stdout: "", wallMs, language };
    if (inspect?.State?.OOMKilled) return { status: "oom", ok: false, tests: [], error: { type: "MemoryError", message: "The answer used more than 256 MB of memory." }, stdout: "", wallMs, language };
    // No result line: the answer ended the interpreter itself, or the sandbox ended it. Under gVisor, an answer that
    // keeps about 20 or more processes alive at once is ended this way (exit code 2), instead of a fork failing.
    if (!line) {
      return { status: "crashed", ok: false, tests: [], error: { type: "Crashed", message: `The sandbox stopped the answer before it finished (exit code ${inspect?.State?.ExitCode ?? "?"}). This usually means it started too many processes at once, or ${language === "python" ? "called os._exit or os.abort" : "called process.exit or process.abort"}.` }, stdout: output.slice(-4000), wallMs, language };
    }
    const result = JSON.parse(line.slice(nonce.length));
    return { status: result.error ? "error" : result.ok ? "passed" : "failed", ...result, wallMs, language };
  } finally {
    await removeContainer(id);
  }
}

// --- Queue ---------------------------------------------------------------------------------------------------------

let running = 0;
const waiting = [];
function schedule(task) {
  return new Promise((resolve, reject) => {
    const go = () => {
      running += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          running -= 1;
          waiting.shift()?.();
        });
    };
    if (running < MAX_RUNNING) go();
    else waiting.push(go);
  });
}

// --- HTTP ----------------------------------------------------------------------------------------------------------

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

/** The platform signs `<time>.<body>` with HMAC-SHA256; requests older than five minutes are refused (no replays). */
function signed(req, body) {
  const time = Number(req.headers["x-grader-time"]);
  const signature = String(req.headers["x-grader-signature"] ?? "");
  if (!Number.isFinite(time) || Math.abs(Date.now() - time) > CLOCK_SKEW_MS || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", SECRET).update(`${time}.`).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error("Request too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://grader");
    if (req.method === "GET" && url.pathname === "/healthz") return send(res, 200, { ok: true, running, waiting: waiting.length });
    if (req.method !== "POST" || url.pathname !== "/v1/run") return send(res, 404, { ok: false, message: "Not found." });

    const body = await readBody(req);
    if (!signed(req, body)) return send(res, 401, { ok: false, message: "Unsigned or expired request." });
    let input;
    try {
      input = JSON.parse(body.toString("utf8"));
    } catch {
      return send(res, 400, { ok: false, message: "Invalid JSON." });
    }
    const code = typeof input.code === "string" ? input.code : null;
    const tests = typeof input.tests === "string" ? input.tests : "";
    if (code === null || code.length > MAX_CODE || tests.length > MAX_CODE) return send(res, 400, { ok: false, message: "code (and tests) must be text of at most 64 KB." });
    const timeoutMs = Math.min(Math.max(Number(input.timeoutMs) || DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS);
    const language = input.language === undefined ? "python" : input.language;
    if (!Object.hasOwn(LANGUAGES, language)) return send(res, 400, { ok: false, message: "language must be python or typescript." });
    if (!LANGUAGES[language].image()) return send(res, 400, { ok: false, message: `This grader has no ${language} sandbox (GRADER_TS_IMAGE isn't set).` });
    if (waiting.length >= MAX_WAITING) return send(res, 503, { ok: false, message: "The grader is busy. Try again in a moment." });

    const result = await schedule(() => run({ code, tests, timeoutMs, language }));
    log({ event: "grader.run", language, status: result.status, tests: result.tests?.length ?? 0, wallMs: result.wallMs, running, waiting: waiting.length });
    return send(res, 200, result);
  } catch (error) {
    const status = error.status ?? 500;
    if (status >= 500) log({ event: "grader.error", error: String(error.stack ?? error).slice(0, 1000) });
    if (!res.headersSent) send(res, status, { ok: false, message: status >= 500 ? "The grader had a problem." : error.message });
  }
});

await cleanUp();
server.listen(PORT, () => log({ event: "grader.start", port: PORT, image: IMAGE, typescriptImage: TS_IMAGE || null, runtime: RUNTIME }));
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(() => process.exit(0)));
