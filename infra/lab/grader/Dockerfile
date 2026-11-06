# The grader (server.mjs): no dependencies, just Node and Docker's socket. It runs as root inside its container to use
# the socket, which makes it root-equivalent on the host; learner code never runs here, only in the throwaway
# containers it starts (no network, gVisor, tight limits).
FROM node:24-slim

WORKDIR /app
COPY server.mjs harness.py ./
ENV NODE_ENV=production
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
