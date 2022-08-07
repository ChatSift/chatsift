FROM node:16-alpine
LABEL name "automoderator service"

WORKDIR /usr/service

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

RUN wget -O ./services/automod/tlds.txt https://data.iana.org/TLD/tlds-alpha-by-domain.txt

COPY packages/cache ./packages/cache
COPY packages/broker-types ./packages/broker-types
COPY packages/injection ./packages/injection
COPY packages/logger ./packages/logger
COPY packages/util ./packages/util

RUN yarn turbo run build --filter=./packages/*

COPY services/automod ./services/automod
COPY services/discord-proxy ./services/discord-proxy
COPY services/gateway ./services/gateway
COPY services/interactions ./services/interactions
COPY services/logging ./services/logging
COPY services/mod-observer ./services/mod-observer
COPY services/scheduler ./services/scheduler

RUN yarn turbo run build --filter=./services/*

RUN yarn workspaces focus --all --production
