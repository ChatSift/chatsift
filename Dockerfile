# TODO: Split into diff images once https://github.com/vercel/turbo/issues/2791 is fixed

FROM node:18-alpine
LABEL name "automoderator"

WORKDIR /usr/automoderator

RUN apk add --update \
&& apk add --no-cache ca-certificates \
&& apk add --no-cache --virtual .build-deps curl git python3 alpine-sdk openssl1.1-compat

COPY turbo.json package.json tsconfig.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn

COPY packages/core/package.json ./packages/core/package.json

COPY services/discord-proxy/package.json ./services/discord-proxy/package.json
COPY services/gateway/package.json ./services/gateway/package.json
COPY services/interactions/package.json ./services/interactions/package.json
COPY services/logging/package.json ./services/logging/package.json
COPY services/task-runner/package.json ./services/task-runner/package.json

RUN yarn --immutable

COPY prisma ./prisma
RUN yarn prisma generate

COPY packages/core ./packages/core

COPY services/discord-proxy ./services/discord-proxy
COPY services/gateway ./services/gateway
COPY services/interactions ./services/interactions
COPY services/logging ./services/logging
COPY services/task-runner ./services/task-runner

ARG TURBO_TEAM
ENV TURBO_TEAM=$TURBO_TEAM
 
ARG TURBO_TOKEN
ENV TURBO_TOKEN=$TURBO_TOKEN

RUN yarn turbo run build

RUN yarn workspaces focus --all --production
