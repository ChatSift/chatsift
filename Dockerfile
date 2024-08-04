FROM node:22-alpine
LABEL name "chatsift-next"

WORKDIR /usr/

RUN apk add --update \
&& apk add --no-cache ca-certificates \
&& apk add --no-cache --virtual .build-deps curl git python3 alpine-sdk

COPY turbo.json package.json tsconfig.json yarn.lock .yarnrc.yml tsup.config.ts ./
COPY .yarn ./.yarn

COPY packages/core/package.json ./packages/core/package.json

COPY packages/npm/discord-utils/package.json ./packages/npm/discord-utils/package.json
COPY packages/npm/parse-relative-time/package.json ./packages/npm/parse-relative-time/package.json
COPY packages/npm/pino-rotate-file/package.json ./packages/npm/pino-rotate-file/package.json
COPY packages/npm/readdir/package.json ./packages/npm/readdir/package.json

COPY services/api/package.json ./services/api/package.json
COPY services/discord-proxy/package.json ./services/discord-proxy/package.json
COPY services/gateway/package.json ./services/gateway/package.json
COPY services/interactions/package.json ./services/interactions/package.json
COPY services/observer/package.json ./services/observer/package.json

RUN yarn workspaces focus --all

COPY prisma ./prisma
RUN yarn prisma generate

COPY packages/core ./packages/core

COPY packages/npm/discord-utils ./packages/npm/discord-utils
COPY packages/npm/parse-relative-time ./packages/npm/parse-relative-time
COPY packages/npm/pino-rotate-file ./packages/npm/pino-rotate-file
COPY packages/npm/readdir ./packages/readdir

COPY services/api ./services/api
COPY services/discord-proxy ./services/discord-proxy
COPY services/gateway ./services/gateway
COPY services/interactions ./services/interactions
COPY services/observer ./services/observer

ARG TURBO_TEAM
ENV TURBO_TEAM=$TURBO_TEAM
 
ARG TURBO_TOKEN
ENV TURBO_TOKEN=$TURBO_TOKEN

RUN yarn turbo run build

RUN yarn workspaces focus --all --production
