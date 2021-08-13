FROM automoderator:base
LABEL name "automoderator gateway builder"

WORKDIR /opt/build

COPY services/gateway/package.json ./services/gateway/package.json
RUN pnpm i --frozen-lockfile
COPY services/gateway ./services/gateway
RUN pnpm run build --filter ./services && pnpm prune --prod

FROM node:16-alpine
LABEL name "automoderator gateway"
LABEL version "0.1.0"

WORKDIR /usr/gateway

COPY --from=0 /opt/build ./

CMD ["node", "--enable-source-maps", "services/gateway/dist/index.js"]
