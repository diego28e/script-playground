# The TypeScript sandbox (docs/practice.md, "Languages"): what the grader runs a TypeScript answer in, the way it runs a
# Python one in the lab's student image. Node.js 26 runs the .ts file (it strips the types), TypeScript 7's `tsc` checks
# it first with the course's strict settings, and Node's types describe its built-in modules. Nothing else: no npm
# packages for answers, no network (the grader turns it off), and the grader's limits and gVisor as for Python.
#
# The grader passes the harness in (grader/harness-ts.mjs), so this image changes only when a version does.
#   docker build -t lab-ts-sandbox:<date> infra/lab/grader/ts-sandbox
FROM node:26.13.1-bookworm-slim

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    TS_SANDBOX_ROOT=/opt/ts-sandbox

WORKDIR /opt/ts-sandbox
COPY package.json ./
# npm installs only this machine's build of the native compiler (an optional dependency per platform), so the same file
# builds on a PC (x64) and on the server (arm64).
RUN npm install --no-audit --no-fund --omit=dev \
 && node node_modules/typescript/bin/tsc --version \
 && chmod -R a+rX /opt/ts-sandbox

# The grader runs every answer as 1000:1000 with a read-only filesystem and a writable /tmp.
USER 1000:1000
WORKDIR /tmp
