FROM node:16-alpine
LABEL name "automoderator commands builder"

WORKDIR /opt/build

RUN apk add --update \
&& apk add --no-cache ca-certificates \
&& apk add --no-cache --virtual .build-deps curl git python3 alpine-sdk

RUN curl -L https://unpkg.com/@pnpm/self-installer | node

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./

COPY libs/core/package.json ./libs/core/package.json
COPY libs/discord-permissions/package.json ./libs/discord-permissions/package.json
COPY libs/http-client/package.json ./libs/http-client/package.json
COPY libs/injection/package.json ./libs/injection/package.json
COPY libs/interaction-util/package.json ./libs/interaction-util/package.json
COPY libs/logger/package.json ./libs/logger/package.json
COPY services/commands/package.json ./services/commands/package.json

RUN pnpm i --frozen-lockfile

COPY libs/core ./libs/core
COPY libs/discord-permissions ./libs/discord-permissions
COPY libs/http-client ./libs/http-client
COPY libs/injection ./libs/injection
COPY libs/interaction-util ./libs/interaction-util
COPY libs/logger ./libs/logger
COPY services/commands ./services/commands

RUN pnpm run build && pnpm prune --prod && apk del .build-deps

FROM node:16-alpine
LABEL name "automoderator commands"
LABEL version "0.1.0"

WORKDIR /usr/commands

COPY --from=0 /opt/build ./

CMD ["node", "--enable-source-maps", "services/commands/dist/index.js"]
