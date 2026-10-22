FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src

EXPOSE 8090
CMD ["node", "src/server.js"]
