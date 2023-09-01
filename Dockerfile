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

RUN yarn --immutable

COPY prisma ./prisma
RUN yarn prisma generate

COPY packages/core ./packages/core

ARG TURBO_TEAM
ENV TURBO_TEAM=$TURBO_TEAM
 
ARG TURBO_TOKEN
ENV TURBO_TOKEN=$TURBO_TOKEN

RUN yarn turbo run build

RUN yarn workspaces focus --all --production
