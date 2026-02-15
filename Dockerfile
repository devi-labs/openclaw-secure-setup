FROM node:20-slim

RUN useradd -m -u 10001 appuser
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./

USER 10001
ENV NODE_ENV=production
EXPOSE 8080

CMD ["npm", "start"]
