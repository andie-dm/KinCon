FROM node:22-alpine AS build
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY app/ .
ARG APP_VERSION=dev
RUN APP_VERSION=$APP_VERSION npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/server.js ./
COPY --from=build /app/dist ./dist
ARG APP_VERSION=dev
ENV PORT=8080 APP_VERSION=$APP_VERSION NODE_ENV=production
# The node image's "node" user, by number so runAsNonRoot can check it.
USER 1000
EXPOSE 8080
CMD ["node", "server.js"]
