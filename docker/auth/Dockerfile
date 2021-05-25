FROM node:16-alpine
LABEL name "automoderator auth builder"

WORKDIR /opt/build

RUN apk add --update \
&& apk add --no-cache ca-certificates \
&& apk add --no-cache --virtual .build-deps curl git python3 alpine-sdk

RUN curl -L https://unpkg.com/@pnpm/self-installer | node

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./

COPY services/auth/package.json ./services/auth/package.json

RUN pnpm i --frozen-lockfile && apk del .build-deps

COPY services/auth ./services/auth

RUN pnpm run build && pnpm prune --prod

FROM node:16-alpine
LABEL name "automoderator auth"
LABEL version "0.1.0"

WORKDIR /usr/auth

COPY --from=0 /opt/build ./

CMD ["node", "--enable-source-maps", "services/auth/dist/index.js"]
