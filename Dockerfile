FROM node:22-alpine
LABEL name="chatsift"

WORKDIR /usr/chatsift

RUN apk add --update \
&& apk add --no-cache ca-certificates \
&& apk add --no-cache --virtual .build-deps curl git python3 alpine-sdk

COPY turbo.json package.json tsconfig.base.json tsconfig.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn

# packages package.json
COPY packages/backend/package.json ./packages/backend/package.json
COPY packages/core/package.json ./packages/core/package.json

# services package.json
COPY services/api/package.json ./services/api/package.json

RUN yarn workspaces focus --all

COPY prisma ./prisma

# packages
COPY packages/backend ./packages/backend
COPY packages/core ./packages/core

# services
COPY services/api ./services/api

RUN yarn turbo run build
RUN yarn workspaces focus --all --production
