FROM node:16-alpine
LABEL name "automoderator base"

WORKDIR /opt/build

RUN apk add --update \
&& apk add --no-cache ca-certificates \
&& apk add --no-cache --virtual .build-deps curl git python3 alpine-sdk

RUN curl -L https://unpkg.com/@pnpm/self-installer | node

COPY package.json pnpm-workspace.yaml tsconfig.json pnpm-lock.yaml ./
RUN pnpm i --frozen-lockfile

COPY prisma ./prisma
RUN pnpx prisma generate

COPY packages/chatsift/api-wrapper/package.json ./packages/chatsift/api-wrapper/package.json
COPY packages/chatsift/discord-utils/package.json ./packages/chatsift/discord-utils/package.json
COPY packages/chatsift/readdir/package.json ./packages/chatsift/readdir/package.json
COPY packages/chatsift/rest-utils/package.json ./packages/chatsift/rest-utils/package.json
COPY packages/chatsift/utils/package.json ./packages/chatsift/utils/package.json

RUN pnpm i --frozen-lockfile

COPY packages/chatsift/api-wrapper ./packages/chatsift/api-wrapper
COPY packages/chatsift/discord-utils ./packages/chatsift/discord-utils
COPY packages/chatsift/readdir ./packages/chatsift/readdir
COPY packages/chatsift/rest-utils ./packages/chatsift/rest-utils
COPY packages/chatsift/utils ./packages/chatsift/utils

RUN pnpm --filter "./packages/chatsift/**" build

COPY packages/automoderator/cache/package.json ./packages/automoderator/cache/package.json
COPY packages/automoderator/broker-types/package.json ./packages/automoderator/broker-types/package.json
COPY packages/automoderator/injection/package.json ./packages/automoderator/injection/package.json
COPY packages/automoderator/logger/package.json ./packages/automoderator/logger/package.json
COPY packages/automoderator/util/package.json ./packages/automoderator/util/package.json

RUN pnpm i --frozen-lockfile

COPY packages/automoderator/cache ./packages/automoderator/cache
COPY packages/automoderator/broker-types ./packages/automoderator/broker-types
COPY packages/automoderator/injection ./packages/automoderator/injection
COPY packages/automoderator/logger ./packages/automoderator/logger
COPY packages/automoderator/util ./packages/automoderator/util

RUN pnpm --filter "./packages/automoderator/**" build
