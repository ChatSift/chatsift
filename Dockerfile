# syntax=docker/dockerfile:1

FROM node:24-alpine AS builder
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
COPY services/automoderator-bot/package.json ./services/automoderator-bot/package.json
COPY services/api/package.json ./services/api/package.json
COPY services/discord-proxy/package.json ./services/discord-proxy/package.json
COPY services/modmail-bot/package.json ./services/modmail-bot/package.json
COPY services/social-bot/package.json ./services/social-bot/package.json

RUN yarn workspaces focus --all

# Source. `.dockerignore` keeps node_modules/dist/.next out, so these merge over the manifests above
# without clobbering the installed tree.
COPY packages ./packages
COPY services ./services

ARG TURBO_TEAM
RUN --mount=type=secret,id=turbo_token \
	TURBO_TOKEN="$(cat /run/secrets/turbo_token 2>/dev/null || true)" \
	TURBO_TEAM="${TURBO_TEAM}" \
	yarn turbo run build

RUN yarn workspaces focus --all --production

FROM node:24-alpine
LABEL name="chatsift"

WORKDIR /usr/chatsift

RUN apk add --no-cache ca-certificates

COPY --from=builder /usr/chatsift/package.json ./package.json
COPY --from=builder /usr/chatsift/node_modules ./node_modules
COPY --from=builder /usr/chatsift/packages ./packages
COPY --from=builder /usr/chatsift/services ./services
