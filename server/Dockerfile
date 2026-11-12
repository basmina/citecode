FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

RUN chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node_modules/.bin/tsx", "src/server.ts"]