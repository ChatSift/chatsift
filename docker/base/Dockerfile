FROM node:16-alpine
LABEL name "automoderator base"

WORKDIR /opt/build

RUN apk add --update \
&& apk add --no-cache ca-certificates \
&& apk add --no-cache --virtual .build-deps curl git python3 alpine-sdk

COPY turbo.json package.json tsconfig.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
RUN yarn workspaces focus

COPY prisma ./prisma
RUN yarn prisma generate

COPY packages/cache/package.json ./packages/cache/package.json
COPY packages/broker-types/package.json ./packages/broker-types/package.json
COPY packages/injection/package.json ./packages/injection/package.json
COPY packages/logger/package.json ./packages/logger/package.json
COPY packages/util/package.json ./packages/util/package.json

COPY services/automod/package.json ./services/automod/package.json
COPY services/discord-proxy/package.json ./services/discord-proxy/package.json
COPY services/gateway/package.json ./services/gateway/package.json
COPY services/interactions/package.json ./services/interactions/package.json
COPY services/logging/package.json ./services/logging/package.json
COPY services/mod-observer/package.json ./services/mod-observer/package.json
COPY services/scheduler/package.json ./services/scheduler/package.json

RUN yarn --immutable

COPY packages/cache ./packages/cache
COPY packages/broker-types ./packages/broker-types
COPY packages/injection ./packages/injection
COPY packages/logger ./packages/logger
COPY packages/util ./packages/util

RUN yarn turbo run build --filter=./packages/*
