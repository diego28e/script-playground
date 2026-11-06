# The learning service: the AI tutor's backend (services/learning, docs/ai-tutor.md). Build the bundle first, on
# your PC: `pnpm learning:build` writes dist/server.mjs and schema.prisma into this folder.
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

# The database client, at the platform's versions; Prisma generates it for this machine (arm64 on the server).
COPY package.json ./
RUN npm install --no-audit --no-fund --omit=optional \
 && npm cache clean --force
COPY schema.prisma ./prisma/schema.prisma
RUN npx prisma generate --schema prisma/schema.prisma

COPY dist/server.mjs ./server.mjs

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
