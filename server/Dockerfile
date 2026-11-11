# Debian slim, not Alpine: onnxruntime (local embeddings) needs glibc.
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

# The embedding model downloads on first start into node_modules, so the app user must own it.
RUN chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node_modules/.bin/tsx", "src/server.ts"]