FROM chatsift:automoderator_base
LABEL name "automoderator mod-observer builder"

COPY services/mod-observer/package.json ./services/mod-observer/package.json
RUN pnpm i --frozen-lockfile
COPY services/mod-observer ./services/mod-observer
RUN pnpm run build --filter ./services && pnpm prune --prod

FROM node:16-alpine
LABEL name "automoderator mod-observer"
LABEL version "0.1.0"

WORKDIR /usr/mod-observer

COPY --from=0 /opt/build ./

CMD ["node", "--enable-source-maps", "services/mod-observer/dist/index.js"]
