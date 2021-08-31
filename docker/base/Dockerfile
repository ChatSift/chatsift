FROM node:16-alpine
LABEL name "automoderator base"

WORKDIR /opt/build

RUN apk add --update \
&& apk add --no-cache ca-certificates \
&& apk add --no-cache --virtual .build-deps curl git python3 alpine-sdk

RUN curl -L https://unpkg.com/@pnpm/self-installer | node

COPY package.json pnpm-workspace.yaml tsconfig.json pnpm-lock.yaml ./

RUN pnpm i --frozen-lockfile

COPY libs/banword-flags/package.json ./libs/banword-flags/package.json
COPY libs/cache/package.json ./libs/cache/package.json
COPY libs/core/package.json ./libs/core/package.json
COPY libs/discord-permissions/package.json ./libs/discord-permissions/package.json
COPY libs/filter-ignores/package.json ./libs/filter-ignores/package.json
COPY libs/http-client/package.json ./libs/http-client/package.json
COPY libs/injection/package.json ./libs/injection/package.json
COPY libs/logger/package.json ./libs/logger/package.json
COPY libs/rest/package.json ./libs/rest/package.json
COPY libs/util/package.json ./libs/util/package.json

RUN pnpm i --frozen-lockfile && apk del .build-deps

COPY libs/banword-flags ./libs/banword-flags
COPY libs/cache ./libs/cache
COPY libs/core ./libs/core
COPY libs/discord-permissions ./libs/discord-permissions
COPY libs/filter-ignores ./libs/filter-ignores
COPY libs/http-client ./libs/http-client
COPY libs/injection ./libs/injection
COPY libs/logger ./libs/logger
COPY libs/rest ./libs/rest
COPY libs/util ./libs/util

RUN pnpm run build
