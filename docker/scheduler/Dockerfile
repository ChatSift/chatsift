FROM chatsift/automoderator_base
LABEL name "automoderator scheduler builder"

COPY services/scheduler/package.json ./services/scheduler/package.json
COPY services/scheduler ./services/scheduler

RUN yarn turbo run build --filter=./services/scheduler
RUN yarn workspaces focus --all --production

FROM node:16-alpine
LABEL name "automoderator scheduler"
LABEL version "0.1.0"

WORKDIR /usr/scheduler

COPY --from=0 /opt/build ./

CMD ["node", "--enable-source-maps", "services/scheduler/dist/index.js"]
