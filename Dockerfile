FROM node:24-alpine
LABEL name="chatsift"

WORKDIR /usr/chatsift

RUN apk add --update \
&& apk add --no-cache ca-certificates \
&& apk add --no-cache --virtual .build-deps curl git python3 alpine-sdk

COPY turbo.json package.json tsconfig.base.json tsconfig.json tsup.config.ts yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn

COPY packages/public/discord-utils/package.json ./packages/public/discord-utils/package.json
COPY packages/public/parse-relative-time/package.json ./packages/public/parse-relative-time/package.json
COPY packages/public/pino-rotate-file/package.json ./packages/public/pino-rotate-file/package.json
COPY packages/private/backend-core/package.json ./packages/private/backend-core/package.json
COPY packages/private/bot-core/package.json ./packages/private/bot-core/package.json
COPY packages/private/core/package.json ./packages/private/core/package.json
COPY packages/private/db/package.json ./packages/private/db/package.json

COPY services/ama-bot/package.json ./services/ama-bot/package.json
COPY services/api/package.json ./services/api/package.json
COPY services/discord-proxy/package.json ./services/discord-proxy/package.json
COPY services/modmail-bot/package.json ./services/modmail-bot/package.json
COPY services/social-bot/package.json ./services/social-bot/package.json

RUN yarn workspaces focus --all

COPY packages/public/discord-utils ./packages/public/discord-utils
COPY packages/public/parse-relative-time ./packages/public/parse-relative-time
COPY packages/public/pino-rotate-file ./packages/public/pino-rotate-file
COPY packages/private/backend-core ./packages/private/backend-core
COPY packages/private/bot-core ./packages/private/bot-core
COPY packages/private/core ./packages/private/core
COPY packages/private/db ./packages/private/db

COPY services/ama-bot ./services/ama-bot
COPY services/api ./services/api
COPY services/discord-proxy ./services/discord-proxy
COPY services/modmail-bot ./services/modmail-bot
COPY services/social-bot ./services/social-bot

RUN yarn turbo run build
RUN yarn workspaces focus --all --production
