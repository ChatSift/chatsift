FROM chatsift/automoderator_base
LABEL name "automoderator discord-proxy builder"

WORKDIR /opt/build

COPY services/discord-proxy/package.json ./services/discord-proxy/package.json
RUN pnpm i --frozen-lockfile
COPY services/discord-proxy ./services/discord-proxy
RUN pnpm run build --filter ./services && pnpm prune --prod

FROM node:16-alpine
LABEL name "automoderator discord-proxy"
LABEL version "0.1.0"

WORKDIR /usr/discord-proxy

COPY --from=0 /opt/build ./

EXPOSE 3003

CMD ["node", "--enable-source-maps", "services/discord-proxy/dist/index.js"]
