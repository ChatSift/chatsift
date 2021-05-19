FROM node:16-alpine
LABEL name "project my-microservice builder"

WORKDIR /opt/build

RUN apk add --update \
&& apk add --no-cache ca-certificates \
&& apk add --no-cache --virtual .build-deps curl git python3 alpine-sdk

RUN curl -L https://unpkg.com/@pnpm/self-installer | node

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./

COPY libs/example/package.json ./libs/example/
COPY services/my-microservice/package.json ./services/my-microservice/package.json

RUN pnpm i --frozen-lockfile && apk del .build-deps

COPY libs/example ./libs/example
COPY services/my-microservice ./services/my-microservice

RUN pnpm run build && pnpm prune --prod

FROM node:16-alpine
LABEL name "project my-microservice"
LABEL version "0.1.0"

WORKDIR /usr/my-microservice

COPY --from=0 /opt/build ./

CMD ["node", "--enable-source-maps", "services/my-microservice/dist/index.js"]
