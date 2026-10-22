FROM node:20-alpine

WORKDIR /app

# Dependencies are installed when the container starts (not at build time):
# docker-compose mounts a named volume over /app/node_modules, which hides
# anything installed into the image anyway -- installing here would only make
# every `docker compose up --build` re-download packages the volume already
# has. On start `npm install` is a no-op unless package.json changed.
COPY package*.json ./
COPY . .

EXPOSE 5173

CMD ["sh", "-c", "npm install --no-audit --no-fund && npm run dev -- --host 0.0.0.0 --port 5173"]
