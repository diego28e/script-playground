# syntax=docker/dockerfile:1
# Student image for the lab: JupyterLab plus the course kernel (lc-mastery), started by JupyterHub's
# DockerSpawner as one container per student (see hub/ and README.md).
#
# Build from this folder, pinning the course commit whose pyproject.toml and constraints lock to install:
#   docker build -t lab-lc-mastery:2026-10-19 --build-arg COURSE_REF=<commit sha> infra/lab
#
# Two virtual environments, so JupyterLab's dependencies never move the course's pinned versions:
#   /opt/course   the kernel: the course's [ci,embeddings] extras installed with its constraints lock
#   /opt/jupyter  the server: JupyterLab and jupyterhub-singleuser
# The `mastery` package itself is not installed: a .pth file points the course env at the clone's src/
# in the work volume, so edits there show up after a kernel restart, as with the course's editable install.

ARG PYTHON_IMAGE=python:3.12-slim-bookworm

FROM ${PYTHON_IMAGE} AS build

ARG COURSE_REPO=https://github.com/diego28e/langchain-langgraph-mastery.git
ARG COURSE_REF
ARG CONSTRAINTS=constraints/constraints-2026-10-19.txt
ARG COURSE_EXTRAS=ci,embeddings
ARG JUPYTERLAB_VERSION=4.6.5
ARG JUPYTERHUB_VERSION=6.1.1

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# git for the course clone; a compiler for the one pinned package that ships only a source
# distribution (forbiddenfruit).
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential git \
 && rm -rf /var/lib/apt/lists/*

# A commit sha, not a branch: the layer cache keys on this value, so a branch name would go stale.
RUN test -n "${COURSE_REF}" || { echo "COURSE_REF (a course commit sha) is required" >&2; exit 1; } \
 && git init -q /tmp/course \
 && git -C /tmp/course fetch -q --depth 1 "${COURSE_REPO}" "${COURSE_REF}" \
 && git -C /tmp/course checkout -q FETCH_HEAD \
 && cp "/tmp/course/${CONSTRAINTS}" /opt/course-constraints.txt

# The slow layer (the whole course stack), before the server env so a JupyterLab or JupyterHub bump
# doesn't rebuild it.
RUN python -m venv /opt/course \
 && /opt/course/bin/pip install "/tmp/course[${COURSE_EXTRAS}]" -c /opt/course-constraints.txt \
 && /opt/course/bin/pip uninstall -y mastery \
 && /opt/course/bin/pip check

# jupyterhub-singleuser must match the hub's major version (hub/Dockerfile).
RUN python -m venv /opt/jupyter \
 && /opt/jupyter/bin/pip install "jupyterlab==${JUPYTERLAB_VERSION}" "jupyterhub==${JUPYTERHUB_VERSION}"

# The AI tutor (tutor/, docs/ai-tutor.md): its JupyterLab panel is built here, with Node taken from the official
# image (same Debian, and this machine's architecture), then installed with its server side, which forwards the
# panel's requests to the learning service. jupyter-builder, which builds it, comes with JupyterLab 4.6.
# Last, so a tutor change rebuilds only these layers.
COPY --from=node:24-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:24-bookworm-slim /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
COPY tutor /tmp/tutor
RUN cd /tmp/tutor/labextension \
 && node /usr/local/lib/node_modules/npm/bin/npm-cli.js ci --no-audit --no-fund \
 && node node_modules/typescript/bin/tsc \
 && /opt/jupyter/bin/jupyter-builder build . \
 && mkdir -p /opt/jupyter/share/jupyter/labextensions \
 && cp -r /tmp/tutor/academia_tutor/labextension /opt/jupyter/share/jupyter/labextensions/academia-tutor \
 && /opt/jupyter/bin/pip install /tmp/tutor


FROM ${PYTHON_IMAGE}

ARG COURSE_REPO=https://github.com/diego28e/langchain-langgraph-mastery.git
ARG LEARNER_UID=1000
ARG LEARNER_GID=1000

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg git tini \
 && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid "${LEARNER_GID}" learner \
 && useradd --uid "${LEARNER_UID}" --gid "${LEARNER_GID}" --create-home --shell /bin/bash learner

COPY --from=build /opt/jupyter /opt/jupyter
# Owned by the learner so a lesson's %pip cell works; anything it adds is gone when the container is recreated.
COPY --from=build --chown=learner:learner /opt/course /opt/course
COPY --from=build /opt/course-constraints.txt /opt/course/constraints.txt

ENV COURSE_ROOT=/home/learner/work/langchain-langgraph-mastery
RUN echo "${COURSE_ROOT}/src" > "$(/opt/course/bin/python -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')/lc-mastery-src.pth"

COPY kernel.json /opt/jupyter/share/jupyter/kernels/lc-mastery/kernel.json
COPY jupyter_server_config.py /opt/jupyter/etc/jupyter/jupyter_server_config.py
# Enables the tutor's server extension the way JupyterLab enables itself (a file per extension in .d/).
COPY tutor/jupyter-config/academia_tutor.json /opt/jupyter/etc/jupyter/jupyter_server_config.d/academia_tutor.json
# JupyterLab defaults (theme follows the system, line numbers, no news pop-up); a student's own settings win.
COPY overrides.json /opt/jupyter/share/jupyter/lab/settings/overrides.json
COPY start-lab.sh /usr/local/bin/start-lab
RUN chmod 755 /usr/local/bin/start-lab

# Terminals use the course env first (python, pytest, jupyter nbconvert), as an activated env would.
# JUPYTER_PATH lets the course env's `jupyter` see the lc-mastery kernel too (Lesson 00.02 checks for it).
# Caches and JupyterLab settings live in the work volume so they survive a new container.
ENV PATH=/opt/course/bin:/opt/jupyter/bin:${PATH} \
    JUPYTER_PATH=/opt/jupyter/share/jupyter \
    COURSE_REPO=${COURSE_REPO} \
    LC_MASTERY_ROOT=${COURSE_ROOT} \
    PIP_CONSTRAINT=/opt/course/constraints.txt \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONUTF8=1 \
    HF_HOME=/home/learner/work/.cache/huggingface \
    FASTEMBED_CACHE_PATH=/home/learner/work/.cache/fastembed \
    JUPYTERLAB_SETTINGS_DIR=/home/learner/work/.jupyter/lab/user-settings \
    JUPYTERLAB_WORKSPACES_DIR=/home/learner/work/.jupyter/lab/workspaces

USER learner
WORKDIR /home/learner/work
EXPOSE 8888

# DockerSpawner appends its own arguments (--ip, --port, ...) to this command.
ENTRYPOINT ["tini", "--"]
CMD ["start-lab", "/opt/jupyter/bin/jupyterhub-singleuser"]
