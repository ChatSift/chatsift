FROM chatsift:automoderator_base
LABEL name "automoderator interactions builder"

COPY services/interactions/package.json ./services/interactions/package.json
RUN pnpm i --frozen-lockfile
COPY services/interactions ./services/interactions
RUN pnpm run build --filter ./services && pnpm prune --prod

FROM node:16-alpine
LABEL name "automoderator interactions"
LABEL version "0.1.0"

WORKDIR /usr/interactions

COPY --from=0 /opt/build ./

EXPOSE 3002

CMD ["node", "--enable-source-maps", "services/interactions/dist/index.js"]
