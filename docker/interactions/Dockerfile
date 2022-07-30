FROM chatsift/automoderator_base
LABEL name "automoderator interactions builder"

COPY services/interactions/package.json ./services/interactions/package.json
COPY services/interactions ./services/interactions

RUN yarn turbo run build --filter=./services/interactions
RUN yarn workspaces focus --all --production

FROM node:16-alpine
LABEL name "automoderator interactions"
LABEL version "0.1.0"

WORKDIR /usr/interactions

COPY --from=0 /opt/build ./

EXPOSE 3002

CMD ["node", "--enable-source-maps", "services/interactions/dist/index.js"]
