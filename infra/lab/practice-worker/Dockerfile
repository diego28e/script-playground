# The practice worker: bulk practice work for the platform (services/practice-worker, docs/practice.md "Jobs"). Build
# the bundle first, on your PC: `pnpm practice-worker:build` writes dist/worker.mjs and schema.prisma into this folder.
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

# The database client, at the platform's versions; Prisma generates it for this machine (arm64 on the server).
COPY package.json ./
RUN npm install --no-audit --no-fund --omit=optional \
 && npm cache clean --force
COPY schema.prisma ./prisma/schema.prisma
RUN npx prisma generate --schema prisma/schema.prisma

COPY dist/worker.mjs ./worker.mjs

# Where voiced pieces are kept until their lesson is stored (the lesson-pieces volume, compose.yaml): made here, owned
# by the user the worker runs as, so the volume starts out writable.
RUN mkdir -p /var/lib/adc/pieces && chown node:node /var/lib/adc/pieces

USER node
CMD ["node", "worker.mjs"]
