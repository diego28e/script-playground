# Lab: JupyterHub with the course kernel

Replaces Google Colab for the LangChain & LangGraph Mastery course. It runs on the Oracle Ampere server
(Ubuntu 24.04, **arm64**), behind the host's nginx and a Let's Encrypt certificate.

JupyterHub signs students in with their **Academia del Código account** (the platform is its OpenID Connect
provider, so a student signed in on the platform walks straight in) and starts one container per student from
the student image. Who gets a lab follows enrollment: anyone enrolled in a published course, and platform admins
as lab admins. It runs **one server at a time** today (`LAB_MAX_ACTIVE_SERVERS=1`); opening up to more students
is a change to `.env`, not a rebuild (see [Opening up](#opening-up)).

| File | Purpose |
|---|---|
| `Dockerfile` | The student image: `/opt/course` (the kernel: the course's `[ci,embeddings]` extras with its constraints lock) and `/opt/jupyter` (JupyterLab and `jupyterhub-singleuser`) |
| `start-lab.sh` | On a student's first start: clone the course into their volume and create its `.env` |
| `kernel.json` | Registers the kernel as `lc-mastery` / "Python (lc-mastery)", the name the course's checks expect |
| `jupyter_server_config.py` | The course kernel as the only kernel, dotfiles visible, idle kernels shut down after an hour |
| `hub/Dockerfile`, `hub/jupyterhub_config.py` | JupyterHub 6.1.1 signing in through the platform (OAuthenticator's generic OAuth), DockerSpawner and the idle culler |
| `compose.yaml` | Runs the hub on `127.0.0.1:8000`, and the learning service on the lab's private network |
| `tutor/` | The AI tutor in JupyterLab: the panel (`labextension/`, built inside the student image) and the server extension `academia_tutor`, which forwards to the learning service |
| `learning/` | The learning service's image: the tutor's backend (`services/learning`), built with `pnpm learning:build`; its settings in `learning/.env` |
| `grader/` | The practice grader: runs learners' code answers in throwaway containers from the student image, under gVisor (`grader/server.mjs`, `grader/harness.py`); its secret in `grader/.env` |
| `.dockerignore` | Keeps `.env` files, the services' folders and the tutor's local build output out of the student image's build |
| `nginx/lab.conf` | The host nginx site, with WebSocket support for kernels and terminals |
| `.env.example` | The platform client, the server limit and the per-student limits |

## What lives where

- **Student image:** Python, JupyterLab, every course dependency at the tested versions, ffmpeg, git.
  Rebuilt when the course's constraints change. `%pip` cells in lessons are held to the same lock
  (`PIP_CONSTRAINT`), and anything they install is gone when the container is recreated.
- **A student's volume** (`jupyterhub-user-<name>`, mounted at `/home/learner/work`): their course clone
  with their edited notebooks, `data/`, the course `.env` with their API keys, the embedding-model caches
  and their JupyterLab settings. It outlives the container, which is removed every time the server stops.
- **The hub's volume** (`lab_hub-data`): the hub's database and cookie secret.
- The course's `mastery` package is loaded from the clone's `src/` (a `.pth` file plus `LC_MASTERY_ROOT`), so
  edits there show up after a kernel restart.

## What does not run in the lab

- Lessons that call Docker (12.05-12.07, the Module 06 project, the Docker sandbox in Module 11). Giving a
  student container the Docker socket would give the notebook root on the server. Run them on your PC.
- Ollama (Module 14): add an `ollama/ollama` container on the `jupyterhub` network later and set
  `OLLAMA_BASE_URL`. CPU only on this server.
- `[transformers]` (torch) and QLoRA (14.04 needs a GPU).
- `langgraph dev` / Studio (02.07, 07.06): needs port 2024; run it on your PC for now.

## Set up on the server

Prerequisites:
- Docker Compose v2 and BuildKit. Docker on this server is Ubuntu's `docker.io`, so they are Ubuntu's packages:
  `sudo apt install docker-compose-v2 docker-buildx`.
- A DNS A record `lab.academiadelcodigo.com` → `149.130.186.62` (the domain's DNS is in Route 53); ports
  80/443 open (they already are).
- The hub's client on the platform: as an admin, open `https://academiadelcodigo.com/admin/lab-access` and
  create it with the callback `https://lab.academiadelcodigo.com/hub/oauth_callback`. Copy its client ID and
  secret (the secret is shown once).

1. Copy this folder to `~/lab` on the server (from the repo root on your PC), then, on the server, pick the
   course commit to install from:

   ```bash
   scp -r -i <ssh key> infra/lab ubuntu@149.130.186.62:~/lab
   COURSE_REF=$(git ls-remote https://github.com/diego28e/langchain-langgraph-mastery.git HEAD | cut -f1)
   ```

2. Build the student image natively on the server (no emulation), and check its native libraries on the
   real CPU. onnxruntime (behind fastembed) crashes on import under QEMU emulation, so an emulated arm64
   build on a PC can't prove it; this can:

   ```bash
   docker build -t lab-lc-mastery:2026-10-19 --build-arg COURSE_REF="$COURSE_REF" ~/lab
   docker run --rm --entrypoint python lab-lc-mastery:2026-10-19 -c "import onnxruntime, fastembed, chromadb; print(onnxruntime.__version__)"
   ```

3. Create the hub's `.env` and fill in the platform client's ID and secret:

   ```bash
   cp ~/lab/.env.example ~/lab/.env && chmod 600 ~/lab/.env
   ```

4. nginx and TLS, **before** starting the hub:

   ```bash
   sed 's/LAB_DOMAIN/lab.academiadelcodigo.com/' ~/lab/nginx/lab.conf | sudo tee /etc/nginx/sites-available/lab.academiadelcodigo.com
   sudo ln -s /etc/nginx/sites-available/lab.academiadelcodigo.com /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d lab.academiadelcodigo.com
   ```

5. Start the hub and check it:

   ```bash
   docker compose -f ~/lab/compose.yaml up -d --build
   docker ps --filter name=jupyterhub --format '{{.Names}} {{.Status}} {{.Ports}}'
   curl -sS https://lab.academiadelcodigo.com/hub/api
   ```

6. Open `https://lab.academiadelcodigo.com`, sign in with your platform account and start your server. The first start clones the
   course into your volume. Open `langchain-langgraph-mastery/.env` in JupyterLab and add your keys.

## Test on your PC

The same hub runs on Docker Desktop, signing in through the platform running on your PC. Pick a port that is
free on your PC first (on Windows, `netstat -ano | grep -E "127.0.0.1:8100\s"` prints nothing when 8100 is
free); the examples use 8100. With the platform running locally (`pnpm dev`), create a client at
`http://localhost:3000/admin/lab-access` with the callback `http://localhost:8100/hub/oauth_callback`, then, from
the repo root:

1. Build the student image for your PC's own architecture (no emulation, so it starts fast and onnxruntime works):

   ```bash
   docker build -t lab-lc-mastery:local --build-arg COURSE_REF=<course commit sha> infra/lab
   ```

2. Create `infra/lab/.env` from `.env.example` (it is git-ignored) with these differences from the server's:

   ```bash
   LAB_HUB_PORT=8100
   OAUTH_CALLBACK_URL=http://localhost:8100/hub/oauth_callback
   LAB_PLATFORM_URL=http://localhost:3000
   LAB_PLATFORM_INTERNAL_URL=http://host.docker.internal:3000
   LAB_IMAGE=lab-lc-mastery:local
   LAB_MEM_LIMIT=4G
   LAB_CPU_LIMIT=2
   ```

3. Start it, open `http://localhost:8100` and sign in; stop it with `docker compose down` (your volume stays):

   ```bash
   docker compose -f infra/lab/compose.yaml up -d --build
   ```

## The AI tutor

Each learner gets a **Tutor** panel in JupyterLab's right sidebar (the mortarboard), with "Explain this error" and
"Suggest a fix" when the active cell fails. How it teaches is in `docs/ai-tutor.md`. Three parts:

1. **The panel and the server extension** (`tutor/`), in every student container: the student image builds and
   installs them, so a new image brings them to everyone.
2. **The learning service** (`learning/`), one container beside the hub, reachable only on the lab's network as
   `http://learning:8080`. It asks the hub who each request is for, runs the tutor, and keeps its sessions, memory
   and request ledger in the platform's database.
3. **The models**: the free Gemini models first, then DeepSeek, paid (`lib/ai/gemini.ts` `TUTOR_CHAIN`). A
   platform admin also gets a Model list in the panel to start the chain at a chosen model; it still falls back
   down the list, then wraps to the top.

To deploy or update the learning service, build its bundle on your PC (`pnpm learning:build`, which writes
`learning/dist/server.mjs` and `learning/schema.prisma`), copy `infra/lab` to the server as for the rest of the lab,
create `learning/.env` from `learning/.env.example` (the platform's `DATABASE_URL`, `GEMINI_API_KEY`, and
`DEEPSEEK_API_KEY`), then `docker compose up -d --build learning`. Check it with
`docker compose ps learning` (healthy) and `docker logs learning` (a `learning.start` line).

To test on your PC, run the service with `HUB_API_URL=http://localhost:8100/hub/api pnpm learning:dev` against the
local hub, and point a test lab container at it with `ACADEMIA_LEARNING_URL=http://host.docker.internal:8080`.

## The practice grader

The platform's practice engine (`docs/practice.md`) grades code answers here. `grader` is a small Node service on
`127.0.0.1:8090`, served by nginx at `https://<lab domain>/grader/`; the platform signs every request with
`GRADER_SECRET` (the same value in `grader/.env` and in Amplify), and requests older than five minutes are refused.

Each answer runs in a fresh container from `LAB_IMAGE` (the course's own Python and packages): no network, read-only
except a 16 MB `/tmp`, all capabilities dropped, no privilege gain, 256 MB of memory, one CPU, 64 processes, a time
limit (15 s by default, 30 s at most), as the learner user, under gVisor (`runsc`, a sandbox kernel between the code and
the server's). At most three run at once; thirty more may wait. The container is removed after every run, and on
start the grader removes any left over. The grader holds the Docker socket like the hub, so it is root-equivalent on
the host; learner code never runs in it.

A run's answer is `{status, ok, tests, error, stdout, wallMs}`: `passed`, `failed` (a test's `assert` failed, with its
message), `error` (the code raised), `timeout`, `oom` or `crashed`. `harness.py` runs the code, then every `test_*`
function in the tests against it; it prints its result behind a per-run nonce, so printed text can't pass for it.
Under gVisor, an answer that keeps about 20 or more processes alive at once is ended by the sandbox (`crashed`, exit
code 2) instead of having a fork refused; zombies and threads don't trigger it. The answer is stopped in under a
second and the grader carries on.

Check a grader end to end from your PC with `pnpm grader:check` (right, wrong and hostile answers; it uses
`GRADER_URL` and `GRADER_SECRET` from `.env.local`). On Docker Desktop, which has no gVisor, add `GRADER_RUNTIME=runc`
to `infra/lab/.env`.

## The practice worker

`practice-worker` carries out the practice jobs the platform's admin page starts (`docs/practice.md`, "Jobs"): writing
every missing practice task, drafting every remaining lesson. It runs here, beside the grader, because a job takes
hours and a request on the platform (Amplify) may take 28 s at most; the admin page only starts, stops and watches it.
It reaches the grader on the lab's own network and the platform's database and the model APIs over the internet;
nothing reaches it (no port).

To deploy or update it, build its bundle on your PC (`pnpm practice-worker:build`, which writes
`practice-worker/dist/worker.mjs` and `practice-worker/schema.prisma`), copy `infra/lab` to the server as for the rest
of the lab, create `practice-worker/.env` from `practice-worker/.env.example` (the platform's `DATABASE_URL` and model
keys, `GRADER_URL=http://grader:8080` and the `GRADER_SECRET` from `grader/.env`), then
`docker compose up -d --build practice-worker`. Check it with `docker compose ps practice-worker` (Up) and
`docker logs practice-worker` (a `practice.worker.start` line, then a `practice.job.item` line per task while a job
runs). A stop or an update lets it finish the items in progress (up to 3 minutes); anything cut off goes back in the
queue on the next start. Run one worker only.

To try it on your PC: `pnpm practice-worker:dev` runs it against the database in `.env.local`, with the grader in
`.env.local`'s `GRADER_URL`.

## Day to day

- **Course content changed** (notebooks, `src/mastery`): `git pull` in a JupyterLab terminal, inside
  `~/work/langchain-langgraph-mastery`. Restart the kernel to pick up `src/` changes.
- **Course dependencies changed** (a new constraints file): build a new image with the new `COURSE_REF`, the
  new file as `--build-arg CONSTRAINTS=constraints/constraints-<date>.txt` and its date as the tag; set
  `LAB_IMAGE` in `.env`, run `docker compose up -d`, then stop and start your server from the hub's
  control panel (`/hub/home`).
- **JupyterLab or JupyterHub:** bump `JUPYTERLAB_VERSION` / `JUPYTERHUB_VERSION` in `Dockerfile` and the hub
  image tag in `hub/Dockerfile` together (the hub and `jupyterhub-singleuser` must share a major version).
- **Backups:** a student's files are their volume:

  ```bash
  docker run --rm -v jupyterhub-user-<name>:/work:ro -v ~/backups:/backup alpine tar czf /backup/lab-<name>.tgz -C /work .
  ```

## Opening up

Change these in `.env`, then `docker compose up -d`:

| Setting | One student | Several students |
|---|---|---|
| `LAB_MAX_ACTIVE_SERVERS` | 1 | about 4-5 on this server (4 cores, 24 GB; a running lab uses 1-3 GB) |
| Who gets in | enroll in a course (or be an admin) | students enroll in a course on the platform; nothing changes here |
| `LAB_MEM_LIMIT`, `LAB_CPU_LIMIT` | 12G, 3 | about 4G and 1 each |

Decide too who pays for API calls: each student's own keys in their `.env`, or the platform's.
