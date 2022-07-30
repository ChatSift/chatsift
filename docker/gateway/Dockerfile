FROM chatsift/automoderator_base
LABEL name "automoderator gateway builder"

WORKDIR /opt/build

COPY services/gateway/package.json ./services/gateway/package.json
COPY services/gateway ./services/gateway

RUN yarn turbo run build --filter=./services/gateway
RUN yarn workspaces focus --all --production

FROM node:16-alpine
LABEL name "automoderator gateway"
LABEL version "0.1.0"

WORKDIR /usr/gateway

COPY --from=0 /opt/build ./

CMD ["node", "--enable-source-maps", "services/gateway/dist/index.js"]
