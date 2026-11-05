# Lab: JupyterHub with the course kernel

Replaces Google Colab for the LangChain & LangGraph Mastery course. It runs on the Oracle Ampere server
(Ubuntu 24.04, **arm64**), behind the host's nginx and a Let's Encrypt certificate.

JupyterHub signs students in with Google and starts one container per student from the student image.
It is set up for **one student** today (`LAB_MAX_ACTIVE_SERVERS=1` and a one-account allow-list); opening
the platform to more students is a change to `.env`, not a rebuild (see [Opening up](#opening-up)).

| File | Purpose |
|---|---|
| `Dockerfile` | The student image: `/opt/course` (the kernel: the course's `[ci,embeddings]` extras with its constraints lock) and `/opt/jupyter` (JupyterLab and `jupyterhub-singleuser`) |
| `start-lab.sh` | On a student's first start: clone the course into their volume and create its `.env` |
| `kernel.json` | Registers the kernel as `lc-mastery` / "Python (lc-mastery)", the name the course's checks expect |
| `jupyter_server_config.py` | The course kernel as the only kernel, dotfiles visible, idle kernels shut down after an hour |
| `hub/Dockerfile`, `hub/jupyterhub_config.py` | JupyterHub 6.1.1 with Google login (OAuthenticator), DockerSpawner and the idle culler |
| `compose.yaml` | Runs the hub on `127.0.0.1:8000` |
| `nginx/lab.conf` | The host nginx site, with WebSocket support for kernels and terminals |
| `.env.example` | The OAuth client, the allow-list, the server limit and the per-student limits |

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
- A Google OAuth client: in the Google Cloud project of the platform's login, create an OAuth client of type
  *Web application* with the authorized redirect URI `https://lab.academiadelcodigo.com/hub/oauth_callback`.

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

3. Create the hub's `.env` and fill in the OAuth client, the callback URL and your Google email:

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

6. Open `https://lab.academiadelcodigo.com`, sign in with Google and start your server. The first start clones the
   course into your volume. Open `langchain-langgraph-mastery/.env` in JupyterLab and add your keys.

## Test on your PC

The same hub runs on Docker Desktop, with Google login through `http://localhost:<port>`. Pick a port that is
free on your PC first (on Windows, `netstat -ano | grep -E "127.0.0.1:8100\s"` prints nothing when 8100 is
free); the examples use 8100. Add `http://localhost:8100/hub/oauth_callback` to the OAuth client's authorized
redirect URIs (Google allows plain HTTP for `localhost` only), then, from the repo root:

1. Build the student image for your PC's own architecture (no emulation, so it starts fast and onnxruntime works):

   ```bash
   docker build -t lab-lc-mastery:local --build-arg COURSE_REF=<course commit sha> infra/lab
   ```

2. Create `infra/lab/.env` from `.env.example` (it is git-ignored) with these differences from the server's:

   ```bash
   LAB_HUB_PORT=8100
   OAUTH_CALLBACK_URL=http://localhost:8100/hub/oauth_callback
   LAB_IMAGE=lab-lc-mastery:local
   LAB_MEM_LIMIT=4G
   LAB_CPU_LIMIT=2
   ```

3. Start it, open `http://localhost:8100` and sign in; stop it with `docker compose down` (your volume stays):

   ```bash
   docker compose -f infra/lab/compose.yaml up -d --build
   ```

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
| `LAB_ALLOWED_USERS` | your account | your students' accounts |
| `LAB_MEM_LIMIT`, `LAB_CPU_LIMIT` | 12G, 3 | about 4G and 1 each |

Decide too who pays for API calls: each student's own keys in their `.env`, or the platform's.
