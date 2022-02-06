FROM chatsift/automoderator_base
LABEL name "automoderator api builder"

WORKDIR /opt/build

COPY services/api/package.json ./services/api/package.json
RUN pnpm i --frozen-lockfile
COPY services/api ./services/api

RUN pnpm run build --filter ./services && pnpm prune --prod

FROM node:16-alpine
LABEL name "automoderator api"
LABEL version "0.1.0"

WORKDIR /usr/api

COPY --from=0 /opt/build ./

EXPOSE 3001

CMD ["node", "--enable-source-maps", "services/api/dist/index.js"]
