FROM node:22-alpine
LABEL name "chatsift-next"

WORKDIR /usr/

RUN apk add --update \
&& apk add --no-cache ca-certificates \
&& apk add --no-cache --virtual .build-deps curl git python3 alpine-sdk

COPY turbo.json package.json tsconfig.json yarn.lock .yarnrc.yml tsup.config.ts ./
COPY .yarn ./.yarn

# NPM package.json
COPY packages/npm/discord-utils/package.json ./packages/npm/discord-utils/package.json
COPY packages/npm/parse-relative-time/package.json ./packages/npm/parse-relative-time/package.json
COPY packages/npm/pino-rotate-file/package.json ./packages/npm/pino-rotate-file/package.json
COPY packages/npm/readdir/package.json ./packages/npm/readdir/package.json

# services package.json
COPY packages/services/automoderator/package.json ./packages/services/automoderator/package.json
COPY packages/services/core/package.json ./packages/services/core/package.json

# shared package.json
COPY packages/shared/package.json ./packages/shared/package.json

# root services package.json
COPY services/api/package.json ./services/api/package.json

# automoderator services package.json
COPY services/automoderator/discord-proxy/package.json ./services/automoderator/discord-proxy/package.json
COPY services/automoderator/gateway/package.json ./services/automoderator/gateway/package.json
COPY services/automoderator/interactions/package.json ./services/automoderator/interactions/package.json
COPY services/automoderator/observer/package.json ./services/automoderator/observer/package.json

RUN yarn workspaces focus --all

COPY prisma ./prisma
RUN yarn prisma generate

# NPM
COPY packages/npm/discord-utils ./packages/npm/discord-utils
COPY packages/npm/parse-relative-time ./packages/npm/parse-relative-time
COPY packages/npm/pino-rotate-file ./packages/npm/pino-rotate-file
COPY packages/npm/readdir ./packages/npm/readdir

# services
COPY packages/services/automoderator ./packages/services/automoderator
COPY packages/services/core ./packages/services/core

# shared
COPY packages/shared ./packages/shared

# root services
COPY services/api ./services/api

# automoderator services
COPY services/automoderator/discord-proxy ./services/automoderator/discord-proxy
COPY services/automoderator/gateway ./services/automoderator/gateway
COPY services/automoderator/interactions ./services/automoderator/interactions
COPY services/automoderator/observer ./services/automoderator/observer

ARG TURBO_TEAM
ENV TURBO_TEAM=$TURBO_TEAM
 
ARG TURBO_TOKEN
ENV TURBO_TOKEN=$TURBO_TOKEN

RUN yarn turbo run build

RUN yarn workspaces focus --all --production
