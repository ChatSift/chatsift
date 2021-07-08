FROM node:16-alpine
LABEL name "automoderator logging builder"

WORKDIR /opt/build

RUN apk add --update \
&& apk add --no-cache ca-certificates \
&& apk add --no-cache --virtual .build-deps curl git python3 alpine-sdk

RUN curl -L https://unpkg.com/@pnpm/self-installer | node

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./

COPY libs/core/package.json ./libs/core/package.json
COPY libs/http-client/package.json ./libs/http-client/package.json
COPY libs/injection/package.json ./libs/injection/package.json
COPY libs/logger/package.json ./libs/logger/package.json
COPY services/logging/package.json ./services/logging/package.json

RUN pnpm i --frozen-lockfile

COPY libs/core ./libs/core
COPY libs/http-client ./libs/http-client
COPY libs/injection ./libs/injection
COPY libs/logger ./libs/logger
COPY services/logging ./services/logging

RUN pnpm run build && pnpm prune --prod && apk del .build-deps

FROM node:16-alpine
LABEL name "automoderator logging"
LABEL version "0.1.0"

WORKDIR /usr/logging

COPY --from=0 /opt/build ./

CMD ["node", "--enable-source-maps", "services/logging/dist/index.js"]
