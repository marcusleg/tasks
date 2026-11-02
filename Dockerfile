# better-sqlite3 runs node-gyp on install, which needs Python and a toolchain
# (it only compiles when no prebuilt binary matches the platform).
FROM node:26-slim AS base
WORKDIR /app
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
	&& npm cache clean --force

FROM node:26-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
	PORT=3000 \
	DATABASE_PATH=/data/tasks.db

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
COPY package.json ./

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000

CMD ["node", "build"]
