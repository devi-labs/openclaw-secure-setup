FROM node:20-slim

# Install git for sandbox PR workflow
RUN apt-get update \
  && apt-get install -y --no-install-recommends git bash ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 10001 appuser
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY src ./src

# Sandbox workdir
ENV OPENCLAW_WORKDIR=/tmp/openclaw-jobs
RUN mkdir -p /tmp/openclaw-jobs && chown -R 10001:10001 /tmp/openclaw-jobs

USER 10001
ENV NODE_ENV=production
ENV CI=1
EXPOSE 8080

CMD ["npm", "start"]
