FROM node:16-alpine
LABEL name "automoderator api builder"

WORKDIR /opt/build

RUN apk add --update \
&& apk add --no-cache ca-certificates \
&& apk add --no-cache --virtual .build-deps curl git python3 alpine-sdk

RUN curl -L https://unpkg.com/@pnpm/self-installer | node

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./

COPY libs/core/package.json ./libs/core/package.json
COPY libs/injection/package.json ./libs/injection/package.json
COPY libs/logger/package.json ./libs/logger/package.json
COPY libs/rest/package.json ./libs/rest/package.json
COPY services/api/package.json ./services/api/package.json

RUN pnpm i --frozen-lockfile && apk del .build-deps

COPY libs/core ./libs/core
COPY libs/injection ./libs/injection
COPY libs/logger ./libs/logger
COPY libs/rest ./libs/rest
COPY services/api ./services/api

RUN pnpm run build && pnpm prune --prod

FROM node:16-alpine
LABEL name "automoderator api"
LABEL version "0.1.0"

WORKDIR /usr/api

COPY --from=0 /opt/build ./

EXPOSE 3001

CMD ["node", "--enable-source-maps", "services/api/dist/index.js"]
