FROM chatsift/automoderator_base
LABEL name "automoderator logging builder"

COPY services/logging/package.json ./services/logging/package.json
COPY services/logging ./services/logging

RUN yarn turbo run build --filter=./services/logging
RUN yarn workspaces focus --all --production

FROM node:16-alpine
LABEL name "automoderator logging"
LABEL version "0.1.0"

WORKDIR /usr/logging

COPY --from=0 /opt/build ./

CMD ["node", "--enable-source-maps", "services/logging/dist/index.js"]
