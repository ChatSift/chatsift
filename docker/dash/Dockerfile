FROM chatsift/automoderator_base
LABEL name "automoderator dash builder"

WORKDIR /opt/build

COPY services/dash/package.json ./services/dash/package.json
RUN pnpm i --frozen-lockfile
COPY services/dash ./services/dash
RUN pnpm --filter "./services/**" build && pnpm prune --prod

FROM node:16-alpine
LABEL name "automoderator dash"
LABEL version "0.1.0"

WORKDIR /usr/dash

RUN apk add --update \
&& apk add --no-cache ca-certificates \
&& apk add --no-cache --virtual .build-deps curl

RUN curl -L https://unpkg.com/@pnpm/self-installer | node

COPY --from=0 /opt/build ./

EXPOSE 4000

CMD ["pnpm", "run", "--dir", "services/dash", "start"]
